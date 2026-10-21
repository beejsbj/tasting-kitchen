import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { computeSkillHash } from "./skills.mjs";
import { sha256 } from "./catalog.mjs";
import { pathExists, walkFiles, within, writeJsonAtomic } from "./files.mjs";

/**
 * A Dish's receipts are sidecars beside dish.json. They are deliberately not
 * part of dish.json or dishHash: they let a reader see what the model received
 * (`inputs.json` plus `inputs/`) and what it ran as (`receipt.json`) without a
 * separate frozen store, and they never change an accepted manifest.
 */
export const INPUTS_DIRECTORY = "inputs";
export const INPUTS_MANIFEST = "inputs.json";
export const RECEIPT_MANIFEST = "receipt.json";

/** `fixtures` are recipe fixture declarations carrying `sha256` and, for public ones, `bytes` (a Buffer). */
export function createInputsManifest(recipe, fixtures) {
  return {
    schemaVersion: 1,
    recipe: { id: recipe.id, hash: recipe.recipeHash },
    fixtures: fixtures.map((fixture) => ({
      id: fixture.id,
      path: fixture.path,
      mountAs: fixture.mountAs,
      public: fixture.public !== false,
      editable: fixture.editable === true,
      ...(fixture.mediaType === undefined ? {} : { mediaType: fixture.mediaType }),
      sha256: fixture.sha256,
      bytes: fixture.size,
    })),
  };
}

export function createReceipt(variant, skill, recipe) {
  return {
    schemaVersion: 1,
    configuration: { ...variant, configHash: variant.configHash },
    skill: skill
      ? { id: skill.id, hash: skill.skillHash, source: skill.source, entry: skill.entry, treeHash: skill.treeHash,
        delivery: skill.delivery ?? "workspace",
        ...(skill.delivery === "prompt" ? {} : { mountAs: recipe?.skills?.mountAs ?? "skill" }) }
      : null,
  };
}

/** Write inputs.json, the public fixture bytes under inputs/, and receipt.json into a Dish directory. */
export async function writeDishSidecars(directory, { recipe, fixtures, receipt }) {
  const described = fixtures.map((fixture) => ({ ...fixture, size: fixture.bytes === undefined ? fixture.size : fixture.bytes.length }));
  for (const fixture of described) {
    if (fixture.public === false) continue;
    const target = within(path.join(directory, INPUTS_DIRECTORY), fixture.mountAs, `fixture mount ${fixture.id}`);
    await writeJsonOrBytes(target, fixture.bytes);
  }
  await writeJsonAtomic(path.join(directory, INPUTS_MANIFEST), createInputsManifest(recipe, described));
  await writeJsonAtomic(path.join(directory, RECEIPT_MANIFEST), receipt);
}

async function writeJsonOrBytes(target, bytes) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
}

/** Read a Dish's sidecars, verifying every public input against its recorded hash. Absent sidecars return null. */
export async function readDishSidecars(directory) {
  const inputsFile = path.join(directory, INPUTS_MANIFEST);
  const inputs = await pathExists(inputsFile) ? JSON.parse(await readFile(inputsFile, "utf8")) : null;
  const problems = await verifyInputs(directory, inputs ?? { fixtures: [] });
  if (problems.length) throw new Error(`Invalid Dish inputs: ${problems.join("; ")}`);
  const receiptFile = path.join(directory, RECEIPT_MANIFEST);
  const receipt = await pathExists(receiptFile) ? JSON.parse(await readFile(receiptFile, "utf8")) : null;
  return { inputs, receipt };
}

export async function verifyInputs(directory, inputs) {
  const problems = [];
  if (!Array.isArray(inputs?.fixtures)) return ["fixtures must be an array"];
  const inputRoot = path.join(directory, INPUTS_DIRECTORY);
  let paths = [];
  try {
    const info = await lstat(inputRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) return ["inputs must be a regular directory"];
    paths = await walkFiles(inputRoot);
  } catch (error) {
    if (error.code !== "ENOENT") return [`invalid inputs tree: ${error.message}`];
  }
  const allowed = new Set();
  const mounts = new Set();
  for (const fixture of inputs.fixtures) {
    if (!fixture || typeof fixture.public !== "boolean") { problems.push("fixture public must be a boolean"); continue; }
    if (fixture.mountAs !== undefined) {
      try { within(inputRoot, fixture.mountAs, `input ${fixture.id}`); }
      catch (error) { problems.push(error.message); continue; }
      if (mounts.has(fixture.mountAs)) problems.push(`duplicate input mount: ${fixture.mountAs}`);
      mounts.add(fixture.mountAs);
    }
    if (!fixture.public) continue;
    allowed.add(fixture.mountAs);
    let bytes;
    try { bytes = await readFile(within(path.join(directory, INPUTS_DIRECTORY), fixture.mountAs, `input ${fixture.id}`)); }
    catch (error) { problems.push(`${fixture.id}: ${error.code === "ENOENT" ? "file missing" : error.message}`); continue; }
    if (sha256(bytes) !== fixture.sha256) problems.push(`${fixture.id}: bytes do not match recorded hash`);
    else if (bytes.length !== fixture.bytes) problems.push(`${fixture.id}: size does not match recorded bytes`);
  }
  for (const relative of paths) if (!allowed.has(relative)) problems.push(`undeclared public input file: ${relative}`);
  return problems;
}

/**
 * Validate a historical receipt against its Dish, independently of today's catalog.
 * mountAs is recipe-hash material, not skill-hash material: containment is checked
 * here, but independent authentication needs the historical recipe contract.
 * Returns a copy with legacy delivery normalized to workspace.
 */
export function validateSkillReceipt(receiptSkill, dishSkill) {
  const fail = (message) => { throw new Error(`Invalid skill receipt: ${message}`); };
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const digest = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
  const safePath = (value, label) => {
    if (typeof value !== "string" || path.win32.isAbsolute(value) || /^[a-z]:/iu.test(value)) fail(`${label} must be a safe relative path`);
    within("/skill-receipt", value, label);
  };
  if (!object(receiptSkill) || !object(dishSkill)) fail("skill and Dish skill are required");
  if (typeof receiptSkill.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(receiptSkill.id) || receiptSkill.id === "none" || receiptSkill.id !== dishSkill.id) fail("id does not bind the Dish");
  if (!digest(receiptSkill.hash) || receiptSkill.hash !== dishSkill.hash) fail("hash does not bind the Dish");
  const source = receiptSkill.source;
  if (!object(source)) fail("source is required");
  let repository;
  try { repository = new URL(source.repository); } catch { fail("source.repository must be an HTTPS repository"); }
  if (typeof source.repository !== "string" || repository.protocol !== "https:" || repository.username || repository.password || !repository.hostname || repository.pathname === "/") fail("source.repository must be an HTTPS repository without credentials");
  if (typeof source.commit !== "string" || !/^[a-f0-9]{40}$/u.test(source.commit)) fail("source.commit must pin a full commit");
  safePath(source.path, "source.path");
  if (source.license !== undefined && (typeof source.license !== "string" || !source.license.trim())) fail("source.license must be non-empty text");
  safePath(receiptSkill.entry, "entry");
  if (!digest(receiptSkill.treeHash)) fail("treeHash must be SHA256");
  const delivery = receiptSkill.delivery === undefined ? "workspace" : receiptSkill.delivery;
  if (delivery !== "workspace" && delivery !== "prompt") fail("unknown delivery");
  if (delivery === "workspace") safePath(receiptSkill.mountAs, "mountAs");
  else if (Object.hasOwn(receiptSkill, "mountAs")) fail("prompt delivery must not have mountAs");
  if (computeSkillHash(receiptSkill, receiptSkill.treeHash) !== dishSkill.hash) fail("pinned skill does not reproduce the Dish hash");
  return { ...receiptSkill, delivery };
}
