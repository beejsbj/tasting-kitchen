import { access, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { walkFiles, within } from "./files.mjs";

function payload(record) {
  return record && typeof record.payload === "object" ? record.payload : record;
}

function providerId(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.id ?? value.name ?? null;
  return null;
}

/** Rollout files whose name carries the thread id, under a home that may hold anything else (live). */
async function rolloutsNamed(root, threadId, relative = "") {
  const entries = await readdir(relative ? path.join(root, relative) : root, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await rolloutsNamed(root, threadId, child));
    else if (entry.isFile() && entry.name.includes(threadId)) found.push(child);
  }
  return found;
}

/**
 * `byName` looks only at rollouts whose file name carries the thread id. A live
 * home holds all his past sessions, so it must not read every one of them.
 */
export async function findRollout(codexHome, threadId, { byName = false } = {}) {
  const sessions = path.join(codexHome, "sessions");
  let files;
  try {
    files = (byName ? await rolloutsNamed(sessions, threadId) : await walkFiles(sessions)).filter((relative) => relative.endsWith(".jsonl"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("Codex did not create a private session rollout");
    throw error;
  }
  const matches = [];
  for (const relative of files) {
    const filename = within(sessions, relative);
    const text = await readFile(filename, "utf8");
    if (text.includes(threadId)) matches.push({ filename, text });
  }
  if (matches.length !== 1) throw new Error(`Expected one private rollout for ${threadId}; found ${matches.length}`);
  return matches[0];
}

export function extractObservedIdentity(jsonl) {
  const records = jsonl.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`Invalid private rollout JSONL on line ${index + 1}: ${error.message}`); }
  });
  let settings = null;
  let context = null;
  let meta = null;
  for (const record of records) {
    if (record?.type === "event_msg" && record.payload?.type === "thread_settings_applied") settings = record.payload.thread_settings ?? record.payload;
    else if (record?.type === "thread_settings_applied") settings = payload(record);
    else if (record?.type === "turn_context") context = payload(record);
    else if (record?.type === "session_meta") meta = payload(record);
  }
  return {
    model: settings?.model ?? context?.model ?? null,
    provider: providerId(settings?.model_provider_id) ?? providerId(meta?.model_provider) ?? providerId(meta?.model_provider_id),
    reasoningEffort: settings?.reasoning_effort ?? context?.effort ?? context?.reasoning_effort ?? null,
    personality: settings?.personality ?? context?.personality ?? null,
    serviceTier: settings?.service_tier ?? context?.service_tier ?? null,
    compHash: context?.comp_hash ?? meta?.comp_hash ?? null,
    cliVersion: meta?.cli_version ?? null,
    verifiedBy: settings ? "thread_settings_applied" : context ? "turn_context" : null,
  };
}

/**
 * Codex records a requested fast tier as its canonical priority tier, and
 * Anthropic (through Claude Code) reports the default tier as standard.
 */
export function serviceTiersMatch(requested, observed) {
  if (requested === "fast") return observed === "priority";
  if (requested === "default" && observed === "standard") return true;
  return observed === requested;
}

/** Text of the messages Codex itself injected into the session: instructions, skill index, environment. */
function contextTexts(records) {
  return records
    .filter((record) => record?.type === "response_item" && record.payload?.type === "message" && ["developer", "system", "user"].includes(record.payload.role))
    .flatMap((record) => (Array.isArray(record.payload.content) ? record.payload.content : []).map((part) => part?.text).filter((text) => typeof text === "string"));
}

async function realpathOr(target) {
  return realpath(target).catch(() => target);
}

const INSIDE = (roots, target) => roots.some((root) => {
  const relative = path.relative(root, path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
});

/**
 * A clean Codex Run's own proof that it saw nothing of Burooj's setup or the
 * Kitchen repo: every skill root, skill file, AGENTS.md block and working
 * directory its rollout recorded lies inside the cook directory, and any
 * AGENTS.md instructions are accounted for by a file there. Codex once loaded
 * $HOME/.agents/skills whatever CODEX_HOME said (#42); this makes the next such
 * change fail verification instead of waiting to be noticed. Returns what it
 * found, as names and counts only.
 */
export async function verifyCodexIsolation(rolloutText, { cookDirectory, codexHome }) {
  const records = rolloutText.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const roots = [path.resolve(cookDirectory), await realpathOr(cookDirectory)];
  const outside = (target) => !path.isAbsolute(target) || !INSIDE(roots, target);
  const skillRoots = new Map();
  const skills = new Set();
  const instructionDirectories = [];
  let globalInstructions = 0;
  const cwds = [
    ...records.filter((record) => record?.type === "session_meta" || record?.type === "turn_context").map((record) => payload(record)?.cwd).filter((cwd) => typeof cwd === "string"),
  ];
  for (const text of contextTexts(records)) {
    for (const [, id, root] of text.matchAll(/^- `(r\d+)` = `([^`]+)`\s*$/gmu)) {
      if (outside(root)) throw new Error("A clean Codex run loaded a skill root outside the cook directory");
      skillRoots.set(id, root);
    }
    // Every skill file the index names, whatever its entry looks like; a plugin skill's name has a colon of its own.
    for (const line of text.split("\n")) {
      const file = line.match(/\(file: ([^)\n]+)\)\s*$/u)?.[1];
      if (!file) continue;
      const name = line.match(/^- (.+?): /u)?.[1]?.trim() ?? "unnamed";
      const [rootId, ...rest] = file.split("/");
      const resolved = skillRoots.has(rootId) ? path.join(skillRoots.get(rootId), ...rest) : file;
      if (outside(resolved)) throw new Error(`A clean Codex run loaded skill ${name} from outside the cook directory`);
      skills.add(name);
    }
    const header = text.match(/^# AGENTS\.md instructions for (.+)$/mu);
    if (header && text.startsWith("# AGENTS.md instructions for")) {
      if (outside(header[1].trim())) throw new Error("A clean Codex run loaded AGENTS.md instructions for a directory outside the cook directory");
      instructionDirectories.push(header[1].trim());
    }
    if (text.startsWith("<user_instructions>")) globalInstructions += 1;
    for (const [, cwd] of text.matchAll(/<cwd>([^<]+)<\/cwd>/gu)) cwds.push(cwd.trim());
  }
  if (cwds.some(outside)) throw new Error("A clean Codex run recorded a working directory outside the cook directory");
  // Codex files his global AGENTS.md under the working directory's heading, so a
  // heading inside the cook directory proves nothing alone: a file there must supply it.
  if (instructionDirectories.length || globalInstructions) {
    const candidates = new Set(["AGENTS.md", "AGENTS.override.md"].map((name) => path.join(codexHome, name)));
    for (const directory of instructionDirectories) {
      for (let current = path.resolve(directory); INSIDE(roots, current); current = path.dirname(current)) {
        for (const name of ["AGENTS.md", "AGENTS.override.md"]) candidates.add(path.join(current, name));
        if (roots.includes(current)) break;
      }
    }
    const present = await Promise.all([...candidates].map((file) => access(file).then(() => true, () => false)));
    if (!present.some(Boolean)) throw new Error("A clean Codex run loaded AGENTS.md instructions no file in the cook directory accounts for");
  }
  return { evidence: "codex-rollout", skills: [...skills].sort(), skillRoots: skillRoots.size, instructions: instructionDirectories.length + globalInstructions };
}

export async function verifyObservedIdentity({ codexHome, threadId, variant, cliVersion }) {
  const rollout = await findRollout(codexHome, threadId, { byName: variant?.executionProfile?.environment === "live" });
  // The attempt's codex-home sits in its cook directory; only a clean Run promises nothing came from outside it.
  const isolation = variant?.executionProfile?.environment === "clean" ? await verifyCodexIsolation(rollout.text, { cookDirectory: path.dirname(codexHome), codexHome }) : null;
  const observed = extractObservedIdentity(rollout.text);
  const missing = ["model", "provider", "reasoningEffort", "personality"].filter((key) => !observed[key]);
  if (!observed.serviceTier && variant.serviceTier !== "default") missing.push("serviceTier");
  if (missing.length) throw new Error(`Private rollout lacks effective identity fields: ${missing.join(", ")}`);
  const mismatches = [];
  if (observed.model !== variant.model) mismatches.push(`model requested ${variant.model}, observed ${observed.model}`);
  if (observed.provider !== variant.provider) mismatches.push(`provider requested ${variant.provider}, observed ${observed.provider}`);
  if (observed.reasoningEffort !== variant.reasoningEffort) mismatches.push(`effort requested ${variant.reasoningEffort}, observed ${observed.reasoningEffort}`);
  if (observed.personality !== variant.personality) mismatches.push(`personality requested ${variant.personality}, observed ${observed.personality}`);
  if (observed.serviceTier && !serviceTiersMatch(variant.serviceTier, observed.serviceTier)) mismatches.push(`tier requested ${variant.serviceTier}, observed ${observed.serviceTier}`);
  const normalizeCliVersion = (value) => String(value).replace(/^codex-cli\s+/u, "");
  if (observed.cliVersion && normalizeCliVersion(observed.cliVersion) !== normalizeCliVersion(cliVersion)) mismatches.push(`CLI reported ${cliVersion}, rollout recorded ${observed.cliVersion}`);
  if (mismatches.length) throw new Error(`Effective Codex identity mismatch: ${mismatches.join("; ")}`);
  return {
    ...observed,
    serviceTier: observed.serviceTier ?? variant.serviceTier,
    requestedServiceTier: variant.serviceTier,
    ...(observed.serviceTier ? { observedServiceTier: observed.serviceTier } : {}),
    serviceTierEvidence: observed.serviceTier ? "rollout" : "requested-default",
    rolloutPath: rollout.filename,
    ...(isolation ? { isolation } : {}),
  };
}
