import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertPublicTextSafe, pathExists } from "./files.mjs";
import { localRequestOrigin, readRequestJson, RecipeBookError, sendJson, validLocalMutation } from "./recipe-book.mjs";
import { loadNoDishes, loadPrivateNoDishes } from "./no-dishes.mjs";
import { loadDishes, loadPrivateDishes } from "./registry.mjs";

/**
 * A verdict is a judge's pass or fail on one plate (a Dish or a No Dish),
 * attached beside it in `verdicts/` (never inside dish.json or no-dish.json)
 * and pinned to its hash. A No Dish takes only a pass: Burooj overruling checks
 * that failed a plate he judges good, which his judgment settles. Verdicts are
 * append-only: a changed mind is a newer file, and the newest from the
 * highest-ranked judge stands. Burooj (`owner`) is the only judge today and
 * outranks every automated check; a later judge (such as a model council)
 * joins JUDGE_RANK below him without changing how his verdict reads.
 */
export const VERDICTS_DIRECTORY = "verdicts";
export const VERDICT_VALUES = ["failed", "passed"];
/** Lower ranks first. Only the owner exists; the seam for other judges is this table. */
export const JUDGE_RANK = { owner: 0 };
export const OWNER = { kind: "owner", name: "Burooj" };

const VERDICT_ID = /^verdict_[a-zA-Z0-9_-]+$/u;
const PLATE_ID = /^(?:dish|nodish)_[a-zA-Z0-9_-]+$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const NOTE_LIMIT = 500;

export class VerdictError extends Error {
  constructor(message, code = "INVALID") {
    super(message);
    this.name = "VerdictError";
    this.code = code;
  }
}

function invalid(label, message) {
  return new VerdictError(`Invalid verdict ${label}: ${message}`);
}

function onlyKeys(value, allowed, label, part) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(label, `${part} must be an object`);
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw invalid(label, `${part} has unknown keys: ${extra.join(", ")}`);
}

function stamp(date) {
  return date.toISOString().replace(/[-:.TZ]/g, "");
}

/** The hash a verdict pins: a Dish's `dishHash` or a No Dish's `noDishHash`. */
export function plateHashOf(plate) {
  return plate?.outcome === "no-dish" ? plate.noDishHash : plate?.dishHash;
}

/** Validate a verdict's shape and, given the plates, that it pins an existing immutable Dish or No Dish. */
export function validateVerdict(verdict, plateById = null, label = verdict?.id ?? "verdict") {
  onlyKeys(verdict, ["schemaVersion", "id", "plateId", "plateHash", "judge", "verdict", "note", "decidedAt"], label, "verdict");
  if (verdict.schemaVersion !== 1) throw invalid(label, "schemaVersion must be 1");
  if (typeof verdict.id !== "string" || !VERDICT_ID.test(verdict.id)) throw invalid(label, "id must be a verdict id");
  if (typeof verdict.plateId !== "string" || !PLATE_ID.test(verdict.plateId)) throw invalid(label, "plateId must be a Dish or No Dish id");
  if (typeof verdict.plateHash !== "string" || !SHA256.test(verdict.plateHash)) throw invalid(label, "plateHash must be a sha256 hash");
  onlyKeys(verdict.judge, ["kind", "name"], label, "judge");
  if (!Object.hasOwn(JUDGE_RANK, verdict.judge.kind)) throw invalid(label, `judge.kind must be one of ${Object.keys(JUDGE_RANK).join(", ")}`);
  if (typeof verdict.judge.name !== "string" || verdict.judge.name.trim() === "" || verdict.judge.name.length > 80) throw invalid(label, "judge.name must be 1-80 characters");
  if (!VERDICT_VALUES.includes(verdict.verdict)) throw invalid(label, `verdict must be ${VERDICT_VALUES.join(" or ")}`);
  if (typeof verdict.note !== "string" || verdict.note.trim() === "" || verdict.note.length > NOTE_LIMIT) throw invalid(label, `note must be 1-${NOTE_LIMIT} characters`);
  try { assertPublicTextSafe(verdict.note, "verdict note"); }
  catch (error) { throw invalid(label, error.message); }
  if (typeof verdict.decidedAt !== "string" || !Number.isFinite(Date.parse(verdict.decidedAt))) throw invalid(label, "decidedAt must be a date-time");
  if (plateById) {
    const plate = plateById.get(verdict.plateId);
    if (!plate) throw invalid(label, `references unknown plate ${verdict.plateId}`);
    if (plateHashOf(plate) !== verdict.plateHash) throw invalid(label, `does not match the immutable hash of ${verdict.plateId}`);
  }
  if (verdict.plateId.startsWith("nodish_") && verdict.verdict !== "passed") throw invalid(label, "a No Dish takes only a pass: there is nothing to fail");
  return verdict;
}

/** A new owner verdict for one plate. Pure: writing is separate. */
export function createVerdict({ plate, verdict, note, now = new Date(), judge = OWNER }) {
  if (!plate?.id || !plateHashOf(plate)) throw new VerdictError("A verdict needs a Dish or No Dish with its hash", "NOT_FOUND");
  const record = {
    schemaVersion: 1,
    id: `verdict_${plate.id}_${stamp(now)}`,
    plateId: plate.id,
    plateHash: plateHashOf(plate),
    judge,
    verdict,
    note: typeof note === "string" ? note.trim() : note,
    decidedAt: now.toISOString(),
  };
  return validateVerdict(record);
}

/** The verdict that stands for a plate: the highest-ranked judge's newest. */
export function standingVerdict(verdicts) {
  return [...verdicts].sort((a, b) => JUDGE_RANK[a.judge.kind] - JUDGE_RANK[b.judge.kind] || b.decidedAt.localeCompare(a.decidedAt) || b.id.localeCompare(a.id))[0];
}

async function readVerdictTree(root, plateById, { publicTree }) {
  if (!await pathExists(root)) return [];
  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const verdicts = [];
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name) !== ".json") throw new VerdictError(`${root} may contain only verdict JSON files: ${entry.name}`);
    let verdict;
    try { verdict = JSON.parse(await readFile(path.join(root, entry.name), "utf8")); }
    catch (error) { throw invalid(entry.name, error.message); }
    validateVerdict(verdict, plateById, entry.name);
    if (`${verdict.id}.json` !== entry.name) throw invalid(entry.name, "filename must match its id");
    if (publicTree && plateById.get(verdict.plateId)?.visibility === "private") throw invalid(entry.name, "a private plate's verdict belongs in private/verdicts");
    verdicts.push(verdict);
  }
  return verdicts;
}

/** Public verdicts in `verdicts/`, validated against the given public plates (Dishes and No Dishes). */
export async function loadVerdicts(repoRoot, { plates }) {
  return readVerdictTree(path.join(repoRoot, VERDICTS_DIRECTORY), new Map(plates.map((plate) => [plate.id, plate])), { publicTree: true });
}

/** Verdicts on private plates, kept in the ignored private tree. */
export async function loadPrivateVerdicts(repoRoot, { plates }) {
  return readVerdictTree(path.join(repoRoot, "private", VERDICTS_DIRECTORY), new Map(plates.map((plate) => [plate.id, plate])), { publicTree: false });
}

/** Record Burooj's verdict beside a Dish or No Dish. A private plate's verdict stays private. */
export async function writeVerdict(repoRoot, { plateId, verdict, note, now = new Date() } = {}) {
  if (typeof plateId !== "string" || !PLATE_ID.test(plateId)) throw new VerdictError("A verdict needs a Dish or No Dish id (dish_… or nodish_…)");
  if (!VERDICT_VALUES.includes(verdict)) throw new VerdictError("A verdict is failed or passed");
  const plates = (await Promise.all([loadDishes(repoRoot), loadPrivateDishes(repoRoot), loadNoDishes(repoRoot), loadPrivateNoDishes(repoRoot)])).flat();
  const plate = plates.find((candidate) => candidate.id === plateId);
  if (!plate) throw new VerdictError(`Unknown Dish or No Dish: ${plateId}`, "NOT_FOUND");
  const record = createVerdict({ plate, verdict, note, now });
  const root = plate.visibility === "private" ? path.join(repoRoot, "private", VERDICTS_DIRECTORY) : path.join(repoRoot, VERDICTS_DIRECTORY);
  await mkdir(root, { recursive: true });
  const filename = path.join(root, `${record.id}.json`);
  try { await writeFile(filename, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" }); }
  catch (error) {
    if (error?.code === "EEXIST") throw new VerdictError(`A verdict was already recorded for ${plateId} at this moment`, "CONFLICT");
    throw error;
  }
  return { verdict: record, path: path.relative(repoRoot, filename).split(path.sep).join("/") };
}

/** Local-development write path, loopback and same-origin only, like Recipe Book saves. */
export function verdictMiddleware(repoRoot) {
  return async function verdictHandler(req, res, next = () => {}) {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (requestUrl.pathname !== "/api/verdicts") return next();
    if (req.method === "GET") {
      if (!localRequestOrigin(req)) return sendJson(res, 403, { error: { code: "FORBIDDEN", message: "Verdicts are writable only from loopback hosts" } });
      return sendJson(res, 200, { writable: true });
    }
    if (req.method !== "POST") return next();
    if (!validLocalMutation(req)) return sendJson(res, 403, { error: { code: "FORBIDDEN", message: "Verdicts require a loopback same-origin request" } });
    try {
      const body = await readRequestJson(req);
      const { verdict } = await writeVerdict(repoRoot, { plateId: body?.plateId, verdict: body?.verdict, note: body?.note });
      return sendJson(res, 200, { verdict });
    } catch (error) {
      const known = error instanceof VerdictError || error instanceof RecipeBookError;
      const status = error?.code === "NOT_FOUND" ? 404 : error?.code === "CONFLICT" ? 409 : known ? 400 : 500;
      return sendJson(res, status, { error: { code: known ? error.code : "INTERNAL", message: known ? error.message : "Could not record the verdict" } });
    }
  };
}
