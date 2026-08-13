export const RECORD_FORMAT = "model-tasting-kitchen.run.v1";
export const EXPORT_FORMAT = "model-tasting-kitchen.records.v1";

const text = (value) => typeof value === "string";
const recordId = () => globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function isRecordComplete(record) {
  return Boolean(record) && record.format === RECORD_FORMAT && text(record.id) && text(record.createdAt) && text(record.updatedAt)
    && text(record.flightId) && text(record.flightTitle) && text(record.dishId) && text(record.dishTitle) && text(record.modelLabel)
    && text(record.configuration) && text(record.reflection) && Array.isArray(record.turns)
    && record.turns.every((turn) => turn && text(turn.turnId) && text(turn.label) && text(turn.kind) && text(turn.prompt) && text(turn.response) && text(turn.note));
}

export function createRecord({ flight, dish, modelLabel, configuration, responses, notes, reflection }) {
  const now = new Date().toISOString();
  return {
    format: RECORD_FORMAT, id: recordId(), createdAt: now, updatedAt: now,
    flightId: flight.id, flightTitle: flight.title, family: flight.family, flightVersion: flight.version,
    dishId: dish.id, dishTitle: dish.title, dishVersion: dish.version,
    modelLabel: modelLabel.trim(), configuration: configuration.trim(), reflection: reflection.trim(),
    turns: dish.turns.map((turn) => ({ turnId: turn.id, label: turn.label, kind: turn.kind, prompt: turn.prompt, response: (responses[turn.id] ?? "").trim(), note: (notes[turn.id] ?? "").trim() })),
  };
}

export function exportRecords(records) {
  const safeRecords = Array.isArray(records) ? records.filter(isRecordComplete) : [];
  return JSON.stringify({ format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), records: safeRecords }, null, 2);
}

export function importRecords(raw, existing) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { accepted: false, records: existing, imported: 0, skipped: 0 }; }
  const candidates = Array.isArray(parsed) ? parsed : parsed?.format === EXPORT_FORMAT && Array.isArray(parsed.records) ? parsed.records : null;
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
