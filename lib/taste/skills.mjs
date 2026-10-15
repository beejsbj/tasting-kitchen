import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { hashCanonical } from "./catalog.mjs";
import { describeTree, pathExists, writeJsonAtomic } from "./files.mjs";

export const NO_SKILL = "none";
const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

/**
 * A skill layer's identity is its pinned source plus the exact mounted bytes.
 * Labels and summaries are display metadata and do not affect comparability.
 */
export function computeSkillHash(skill, treeHash) {
  return hashCanonical({ id: skill.id, source: skill.source, treeHash });
}

/** Load `catalog/skills.json` and hash every skill's mounted file tree. */
export async function loadSkills(repoRoot) {
  const filename = path.join(repoRoot, "catalog", "skills.json");
  if (!await pathExists(filename)) return [];
  const document = await readJson(filename);
  if (document.schemaVersion !== 1 || !Array.isArray(document.skills)) throw new Error("catalog/skills.json must use schemaVersion 1 with a skills array");
  const skills = [];
  const seen = new Set();
  for (const skill of document.skills) {
    if (typeof skill?.id !== "string" || !SKILL_ID.test(skill.id) || skill.id === NO_SKILL) throw new Error(`Invalid skill id: ${String(skill?.id)}`);
    if (seen.has(skill.id)) throw new Error(`Duplicate skill id: ${skill.id}`);
    seen.add(skill.id);
    const root = path.join(repoRoot, "catalog", "skills", skill.id, "files");
    if (!await pathExists(root)) throw new Error(`Skill ${skill.id} has no mounted source at catalog/skills/${skill.id}/files`);
    const described = await describeTree(root);
    if (!described.files.some((file) => file.path === skill.entry)) throw new Error(`Skill ${skill.id} entry ${skill.entry} is not in its mounted files`);
    skills.push({ ...skill, root, files: described.files, treeHash: described.treeHash, skillHash: computeSkillHash(skill, described.treeHash) });
  }
  return skills;
}

/** Resolve a requested layer. `none` and undefined both mean no skill is mounted. */
export function resolveSkill(catalog, skillId) {
  if (skillId === undefined || skillId === null || skillId === NO_SKILL) return null;
  const skill = (catalog.skills ?? []).find((candidate) => candidate.id === skillId);
  if (!skill) throw new Error(`Unknown skill id: ${skillId}`);
  return skill;
}

/** The layer identity recorded on a Dish; absent or null means no skill was mounted. */
export function skillKey(dish) {
  return dish?.skill?.hash ?? NO_SKILL;
}

/** Reasons a layer cannot be cooked with a recipe, or an empty list. */
export function skillCompatibility(recipe, skill) {
  const reasons = [];
  const contract = recipe?.skills;
  if (!skill) {
    if (contract && contract.optional === false) reasons.push("recipe requires a skill layer; none was requested");
    return reasons;
  }
  if (!contract) reasons.push(`recipe accepts no skill layer; ${skill.id} was requested`);
  else if (!contract.layers.includes(skill.id)) reasons.push(`recipe does not list skill layer ${skill.id}`);
  return reasons;
}

export function createSkillRevision(skill) {
  return {
    schemaVersion: 1,
    skillId: skill.id,
    hash: skill.skillHash,
    source: skill.source,
    entry: skill.entry,
    treeHash: skill.treeHash,
    files: skill.files,
    display: { label: skill.label, summary: skill.summary },
  };
}

export function assertSkillRevision(revision) {
  if (!revision || typeof revision !== "object" || !revision.skillId) throw new Error("Skill revision must name its skill");
  if (revision.schemaVersion !== 1) throw new Error("Skill revision must use schemaVersion 1");
  const expected = computeSkillHash({ id: revision.skillId, source: revision.source }, revision.treeHash);
  if (revision.hash !== expected) throw new Error(`Skill revision ${revision.skillId} does not match its source and tree hash`);
  return revision;
}

export async function loadSkillRevisions(repoRoot) {
  const root = path.join(repoRoot, "catalog", "revisions", "skills");
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const revisions = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(async (entry) => assertSkillRevision(await readJson(path.join(root, entry.name)))));
  const hashes = new Set();
  for (const revision of revisions) {
    if (hashes.has(revision.hash)) throw new Error(`Duplicate skill revision ${revision.hash}`);
    hashes.add(revision.hash);
  }
  return revisions;
}

/**
 * Freeze the exact mounted layer before its first run. The revision records
 * file hashes rather than bytes; the catalog tree must keep matching it while
 * any Dish references the hash.
 */
export async function freezeSkillRevision(repoRoot, skill) {
  const revision = createSkillRevision(skill);
  const existing = (await loadSkillRevisions(repoRoot)).find((candidate) => candidate.hash === revision.hash);
  if (existing) return existing;
  const directory = path.join(repoRoot, "catalog", "revisions", "skills");
  const filename = path.join(directory, `${skill.id}--${revision.hash.slice("sha256:".length)}.json`);
  await mkdir(directory, { recursive: true });
  if (await pathExists(filename)) {
    const present = assertSkillRevision(await readJson(filename));
    if (present.hash !== revision.hash) throw new Error(`Skill revision path collision for ${skill.id}`);
    return present;
  }
  await writeJsonAtomic(filename, revision);
  return revision;
}
