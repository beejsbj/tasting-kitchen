import { readFile } from "node:fs/promises";
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

export async function findRollout(codexHome, threadId) {
  const sessions = path.join(codexHome, "sessions");
  let files;
  try {
    files = (await walkFiles(sessions)).filter((relative) => relative.endsWith(".jsonl"));
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

/** Codex records a requested fast tier as its canonical priority tier. */
export function serviceTiersMatch(requested, observed) {
  if (requested === "fast") return observed === "priority";
  return observed === requested;
}

export async function verifyObservedIdentity({ codexHome, threadId, variant, cliVersion }) {
  const rollout = await findRollout(codexHome, threadId);
  const observed = extractObservedIdentity(rollout.text);
  const missing = ["model", "provider", "reasoningEffort", "personality", "serviceTier"].filter((key) => !observed[key]);
  if (missing.length) throw new Error(`Private rollout lacks effective identity fields: ${missing.join(", ")}`);
  const mismatches = [];
  if (observed.model !== variant.model) mismatches.push(`model requested ${variant.model}, observed ${observed.model}`);
  if (observed.provider !== variant.provider) mismatches.push(`provider requested ${variant.provider}, observed ${observed.provider}`);
  if (observed.reasoningEffort !== variant.reasoningEffort) mismatches.push(`effort requested ${variant.reasoningEffort}, observed ${observed.reasoningEffort}`);
  if (observed.personality !== variant.personality) mismatches.push(`personality requested ${variant.personality}, observed ${observed.personality}`);
  if (!serviceTiersMatch(variant.serviceTier, observed.serviceTier)) mismatches.push(`tier requested ${variant.serviceTier}, observed ${observed.serviceTier}`);
  const normalizeCliVersion = (value) => String(value).replace(/^codex-cli\s+/u, "");
  if (observed.cliVersion && normalizeCliVersion(observed.cliVersion) !== normalizeCliVersion(cliVersion)) mismatches.push(`CLI reported ${cliVersion}, rollout recorded ${observed.cliVersion}`);
  if (mismatches.length) throw new Error(`Effective Codex identity mismatch: ${mismatches.join("; ")}`);
  return {
    ...observed,
    requestedServiceTier: variant.serviceTier,
    observedServiceTier: observed.serviceTier,
    rolloutPath: rollout.filename,
  };
}
