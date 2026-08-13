export const LEGACY_RECORD_FORMAT = "model-tasting-kitchen.run.v1";
export const RECORD_FORMAT = "model-tasting-kitchen.run.v2";
export const LEGACY_EXPORT_FORMAT = "model-tasting-kitchen.records.v1";
export const EXPORT_FORMAT = "model-tasting-kitchen.records.v2";

const text = (value) => typeof value === "string";
const recordId = () => globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const validTurn = (turn, version) => turn && text(turn.turnId) && text(turn.label) && text(turn.kind) && text(turn.prompt) && text(turn.response) && text(turn.note)
  && (version === 1 || text(turn.stage));

function hasSharedRecordFields(record) {
  return text(record.id) && text(record.createdAt) && text(record.updatedAt) && text(record.flightId) && text(record.flightTitle)
    && text(record.dishId) && text(record.dishTitle) && text(record.modelLabel) && text(record.configuration) && text(record.reflection) && Array.isArray(record.turns);
}

export function isRecordComplete(record) {
  if (!record || !hasSharedRecordFields(record)) return false;
  if (record.format === LEGACY_RECORD_FORMAT) return record.turns.every((turn) => validTurn(turn, 1));
  return record.format === RECORD_FORMAT && text(record.family) && text(record.flightVersion) && text(record.dishVersion)
    && text(record.activityMode) && text(record.claimBoundary)
    && record.harness && text(record.harness.mode) && Array.isArray(record.harness.mechanics) && text(record.harness.separationNote)
    && record.turns.every((turn) => validTurn(turn, 2));
}

export function createRecord({ flight, dish, modelLabel, configuration, responses, notes, reflection }) {
  const now = new Date().toISOString();
  return {
    format: RECORD_FORMAT, id: recordId(), createdAt: now, updatedAt: now,
    flightId: flight.id, flightTitle: flight.title, family: flight.family, flightVersion: flight.version,
    dishId: dish.id, dishTitle: dish.title, dishVersion: dish.version,
    activityMode: dish.activityMode, claimBoundary: dish.evidenceBasis.claimBoundary,
    harness: { mode: dish.harness.mode, mechanics: dish.harness.mechanics, separationNote: dish.harness.separationNote },
    modelLabel: modelLabel.trim(), configuration: configuration.trim(), reflection: reflection.trim(),
    turns: dish.turns.map((turn) => ({ turnId: turn.id, label: turn.label, kind: turn.kind, stage: turn.stage, prompt: turn.prompt, response: (responses[turn.id] ?? "").trim(), note: (notes[turn.id] ?? "").trim() })),
  };
}

export function exportRecords(records) {
  const safeRecords = Array.isArray(records) ? records.filter(isRecordComplete) : [];
  return JSON.stringify({ format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), records: safeRecords }, null, 2);
}

export function importRecords(raw, existing) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { accepted: false, records: existing, imported: 0, skipped: 0 }; }
  const candidates = Array.isArray(parsed) ? parsed : (parsed?.format === EXPORT_FORMAT || parsed?.format === LEGACY_EXPORT_FORMAT) && Array.isArray(parsed.records) ? parsed.records : null;
  if (!candidates) return { accepted: false, records: existing, imported: 0, skipped: 0 };
  const baseline = Array.isArray(existing) ? existing.filter(isRecordComplete) : [];
  const known = new Set(baseline.map((record) => record.id));
  const additions = [];
  let skipped = 0;
  for (const candidate of candidates) {
    if (!isRecordComplete(candidate) || known.has(candidate.id)) { skipped += 1; continue; }
    known.add(candidate.id); additions.push(candidate);
  }
  return { accepted: true, records: [...additions, ...baseline], imported: additions.length, skipped };
}

export function comparisonEligibility(records) {
  if (records.length < 2) return { allowed: true, reason: "" };
  const [first, second] = records;
  if (first.dishId !== second.dishId) return { allowed: false, reason: "Choose runs of the same dish before comparing them." };
  if (first.dishVersion !== second.dishVersion) return { allowed: false, reason: "Choose runs made with the same dish version before comparing them." };
  return { allowed: true, reason: "" };
}

export function assetDownloadDetails(asset) {
  const content = asset.content ?? "";
  const basename = (asset.title || asset.id || "kitchen-asset").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "kitchen-asset";
  if (/^\s*<svg\b/i.test(content)) return { filename: `${basename}.svg`, type: "image/svg+xml" };
  if (/^\s*<!doctype html|^\s*<html\b/i.test(content)) return { filename: `${basename}.html`, type: "text/html" };
  return { filename: `${basename}.txt`, type: "text/plain" };
}
