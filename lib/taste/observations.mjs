import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { hashCanonical } from "./catalog.mjs";
import { pathExists, writeJsonAtomic } from "./files.mjs";
import { loadMenus } from "./menus.mjs";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const VERSION = /^\d+\.\d+\.\d+$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const OBSERVATION_ID = /^observation_[a-zA-Z0-9_-]+$/u;

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function exactlyKeys(value, allowed, label) {
  requireValue(plainObject(value), `${label} must be an object`);
  for (const key of Object.keys(value)) requireValue(allowed.has(key), `${label} has unknown key ${key}`);
}

function contained(base, relative, label) {
  requireValue(typeof relative === "string" && relative.length > 0 && !relative.includes("\\") && !relative.includes("\0"), `${label} must be a contained relative path`);
  requireValue(!path.posix.isAbsolute(relative) && !path.win32.isAbsolute(relative) && relative.split("/").every((segment) => segment && segment !== "." && segment !== ".."), `${label} must be a contained relative path`);
  const resolved = path.resolve(base, relative);
  requireValue(resolved.startsWith(`${path.resolve(base)}${path.sep}`), `${label} escapes its root`);
  return resolved;
}

async function readJson(filename) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read JSON ${filename}: ${error.message}`, { cause: error });
  }
}

async function jsonFiles(directory) {
  if (!await pathExists(directory)) return [];
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    requireValue(entry.isFile() && path.extname(entry.name) === ".json", `${directory} may contain only JSON files: ${entry.name}`);
    files.push(path.join(directory, entry.name));
  }
  return files;
}

function withoutHash(axisSet) {
  const copy = structuredClone(axisSet);
  delete copy.rubricHash;
  return copy;
}

export function computeAxisSetHash(axisSet) {
  return hashCanonical(withoutHash(axisSet));
}

export function validateAxisSet(axisSet, label = "axis set") {
  exactlyKeys(axisSet, new Set(["schemaVersion", "id", "version", "status", "title", "purpose", "adapter", "contexts", "axes", "revisionNote", "rubricHash"]), label);
  requireValue(axisSet.schemaVersion === 1, `${label}.schemaVersion must be 1`);
  requireValue(ID.test(axisSet.id), `${label}.id has an invalid format`);
  requireValue(VERSION.test(axisSet.version), `${label}.version must be SemVer`);
  requireValue(["active", "candidate", "retired"].includes(axisSet.status), `${label}.status is invalid`);
  requireValue(typeof axisSet.title === "string" && axisSet.title.length > 0, `${label}.title is required`);
  requireValue(typeof axisSet.purpose === "string" && axisSet.purpose.length > 0, `${label}.purpose is required`);
  exactlyKeys(axisSet.adapter, new Set(["shape", "maxBytes"]), `${label}.adapter`);
  requireValue(["conversation", "agentic", "journal"].includes(axisSet.adapter.shape), `${label}.adapter.shape is invalid`);
  requireValue(Number.isInteger(axisSet.adapter.maxBytes) && axisSet.adapter.maxBytes >= 1024 && axisSet.adapter.maxBytes <= 262144, `${label}.adapter.maxBytes is invalid`);
  requireValue(Array.isArray(axisSet.contexts) && axisSet.contexts.length > 0, `${label}.contexts must not be empty`);
  const contextKeys = new Set();
  for (const [index, context] of axisSet.contexts.entries()) {
    exactlyKeys(context, new Set(["kind", "id"]), `${label}.contexts[${index}]`);
    requireValue(["recipe", "menu"].includes(context.kind) && ID.test(context.id), `${label}.contexts[${index}] is invalid`);
    const key = `${context.kind}:${context.id}`;
    requireValue(!contextKeys.has(key), `${label}.contexts contains duplicate ${key}`);
    contextKeys.add(key);
  }
  requireValue(Array.isArray(axisSet.axes) && axisSet.axes.length > 0, `${label}.axes must not be empty`);
  const axisIds = new Set();
  for (const [index, axis] of axisSet.axes.entries()) {
    const axisLabel = `${label}.axes[${index}]`;
    exactlyKeys(axis, new Set(["id", "label", "question", "levels", "consequentialDistance"]), axisLabel);
    requireValue(ID.test(axis.id) && !axisIds.has(axis.id), `${axisLabel}.id is invalid or duplicated`);
    axisIds.add(axis.id);
    requireValue(typeof axis.label === "string" && axis.label.length > 0, `${axisLabel}.label is required`);
    requireValue(typeof axis.question === "string" && axis.question.length > 0, `${axisLabel}.question is required`);
    requireValue(Array.isArray(axis.levels) && axis.levels.length >= 2 && axis.levels.length <= 7, `${axisLabel}.levels must contain 2 to 7 levels`);
    const levelIds = new Set();
    for (const [levelIndex, level] of axis.levels.entries()) {
      exactlyKeys(level, new Set(["id", "label", "description"]), `${axisLabel}.levels[${levelIndex}]`);
      requireValue(ID.test(level.id) && !levelIds.has(level.id), `${axisLabel}.levels[${levelIndex}].id is invalid or duplicated`);
      levelIds.add(level.id);
      requireValue(typeof level.label === "string" && level.label.length > 0, `${axisLabel}.levels[${levelIndex}].label is required`);
      requireValue(typeof level.description === "string" && level.description.length > 0, `${axisLabel}.levels[${levelIndex}].description is required`);
    }
    requireValue(Number.isInteger(axis.consequentialDistance) && axis.consequentialDistance >= 1 && axis.consequentialDistance < axis.levels.length, `${axisLabel}.consequentialDistance is invalid`);
  }
  if (axisSet.revisionNote !== undefined) requireValue(typeof axisSet.revisionNote === "string" && axisSet.revisionNote.length > 0, `${label}.revisionNote must be non-empty`);
  requireValue(HASH.test(axisSet.rubricHash), `${label}.rubricHash is invalid`);
  requireValue(axisSet.rubricHash === computeAxisSetHash(axisSet), `${label}.rubricHash does not match the canonical axis set`);
  return axisSet;
}

export async function loadAxisSets(repoRoot) {
  const root = path.join(repoRoot, "catalog", "axis-sets");
  const sets = [];
  const identities = new Set();
  for (const filename of await jsonFiles(root)) {
    const axisSet = validateAxisSet(await readJson(filename), path.relative(repoRoot, filename));
    requireValue(path.basename(filename) === `${axisSet.id}--${axisSet.version}.json`, `Axis-set filename must match identity: ${filename}`);
    const identity = `${axisSet.id}:${axisSet.version}`;
    requireValue(!identities.has(identity), `Duplicate axis set: ${identity}`);
    identities.add(identity);
    sets.push(axisSet);
  }
  return sets.sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version));
}

export function axisSetsForContext(axisSets, context) {
  return axisSets.filter((axisSet) => axisSet.contexts.some((candidate) => candidate.kind === context.kind && candidate.id === context.id));
}

export function questionsForAxisSet(axisSet) {
  return Object.fromEntries(axisSet.axes.map((axis) => [axis.id, {
    type: "score",
    instructions: axis.question,
    criteria: axis.levels.map((level) => level.description),
  }]));
}

function evidenceReference(dish, file) {
  return { path: file.path, sha256: file.sha256.startsWith("sha256:") ? file.sha256 : `sha256:${file.sha256}` };
}

export function adaptObservationEvidence({ shape, dish, artifact, trace }) {
  requireValue(["conversation", "agentic", "journal"].includes(shape), `Unknown observation adapter shape: ${shape}`);
  const entryFile = dish.artifact.files.find((file) => file.path === dish.artifact.entry);
  requireValue(entryFile, `Dish ${dish.id} does not declare its entry file`);
  const references = [evidenceReference(dish, entryFile)];
  const turns = Array.isArray(artifact?.turns) ? artifact.turns.map((turn) => ({
    id: turn.id,
    role: turn.role,
    prompt: turn.prompt,
    response: turn.response,
    actions: Array.isArray(turn.actions) ? turn.actions : [],
  })) : [];
  if (shape === "conversation" || shape === "journal") {
    requireValue(turns.length > 0, `${shape} adapter requires a session artifact with turns`);
    return { state: { shape, turns }, evidence: references };
  }
  if (dish.publicTrace) references.push({ path: dish.publicTrace, sha256: null });
  return {
    state: {
      shape,
      turns: Array.isArray(trace?.turns) ? trace.turns : turns,
      artifact: { kind: dish.artifact.kind, entry: dish.artifact.entry, files: dish.artifact.files.map((file) => file.path) },
      validation: dish.validation,
    },
    evidence: references,
  };
}

export async function loadDishObservationEvidence(repoRoot, dish, axisSet) {
  const dishRoot = path.join(repoRoot, "dishes", dish.id);
  const entryPath = contained(dishRoot, dish.artifact.entry, `${dish.id}.artifact.entry`);
  const entryBytes = await readFile(entryPath);
  requireValue(entryBytes.byteLength <= axisSet.adapter.maxBytes, `Dish evidence exceeds axis-set maxBytes (${entryBytes.byteLength} > ${axisSet.adapter.maxBytes}); select context explicitly instead of splitting it`);
  let artifact;
  try { artifact = JSON.parse(entryBytes.toString("utf8")); }
  catch { artifact = { text: entryBytes.toString("utf8") }; }
  let trace = null;
  if (dish.publicTrace) {
    const traceBytes = await readFile(contained(dishRoot, dish.publicTrace, `${dish.id}.publicTrace`));
    requireValue(entryBytes.byteLength + traceBytes.byteLength <= axisSet.adapter.maxBytes, `Dish evidence exceeds axis-set maxBytes; select context explicitly instead of splitting it`);
    try { trace = JSON.parse(traceBytes.toString("utf8")); }
    catch { trace = { text: traceBytes.toString("utf8") }; }
  }
  return adaptObservationEvidence({ shape: axisSet.adapter.shape, dish, artifact, trace });
}

// `revisionHash` names the recipe hash the Dish was cooked from. A menu context
// additionally requires the Menu to list that recipe.
function validateContext(context, dish, menus, label) {
  exactlyKeys(context, new Set(["kind", "id", "revisionHash"]), label);
  requireValue(["recipe", "menu"].includes(context.kind) && ID.test(context.id) && HASH.test(context.revisionHash), `${label} is invalid`);
  requireValue(context.revisionHash === dish.recipe.hash, `${label} does not match the Dish recipe hash`);
  if (context.kind === "recipe") {
    requireValue(context.id === dish.recipe.id, `${label} does not match immutable Dish recipe context`);
    return;
  }
  const menu = menus.find((candidate) => candidate.id === context.id);
  requireValue(menu, `${label} references an unknown Menu`);
  requireValue(menu.recipes.includes(dish.recipe.id), `${label} Menu does not list this Dish recipe`);
}

function validateDistribution(distribution, levelIds, label) {
  requireValue(Array.isArray(distribution) && distribution.length === levelIds.length, `${label} must retain one probability per level`);
  let total = 0;
  for (const [index, item] of distribution.entries()) {
    exactlyKeys(item, new Set(["levelId", "probability"]), `${label}[${index}]`);
    requireValue(item.levelId === levelIds[index], `${label} level order must match the axis set`);
    requireValue(typeof item.probability === "number" && Number.isFinite(item.probability) && item.probability >= 0 && item.probability <= 1, `${label}[${index}].probability is invalid`);
    total += item.probability;
  }
  requireValue(Math.abs(total - 1) <= 0.02, `${label} probabilities must sum to 1`);
}

export function validateObservation(observation, { dishes, axisSets, menus = [] } = {}) {
  const label = observation?.id ?? "observation";
  exactlyKeys(observation, new Set(["schemaVersion", "id", "dishId", "dishHash", "context", "axisSet", "source", "observedAt", "evidenceAdapter", "axes", "usage"]), label);
  requireValue(observation.schemaVersion === 1 && OBSERVATION_ID.test(observation.id), `${label}.id or schemaVersion is invalid`);
  requireValue(typeof observation.dishId === "string" && HASH.test(observation.dishHash), `${label} Dish identity is invalid`);
  const dish = dishes?.find((candidate) => candidate.id === observation.dishId);
  requireValue(dish, `${label} references unknown Dish ${observation.dishId}`);
  requireValue(dish.dishHash === observation.dishHash, `${label} does not match immutable Dish hash`);
  validateContext(observation.context, dish, menus, `${label}.context`);
  exactlyKeys(observation.axisSet, new Set(["id", "version", "hash"]), `${label}.axisSet`);
  const axisSet = axisSets?.find((candidate) => candidate.id === observation.axisSet.id && candidate.version === observation.axisSet.version);
  requireValue(axisSet && axisSet.rubricHash === observation.axisSet.hash, `${label} references an unknown or changed axis set`);
  requireValue(axisSet.contexts.some((context) => context.kind === observation.context.kind && context.id === observation.context.id), `${label} axis set does not apply to its comparison context`);
  exactlyKeys(observation.source, new Set(["kind", "evaluator"]), `${label}.source`);
  requireValue(["human", "jev"].includes(observation.source.kind), `${label}.source.kind is invalid`);
  requireValue(plainObject(observation.source.evaluator) && typeof observation.source.evaluator.id === "string" && observation.source.evaluator.id.length > 0, `${label}.source.evaluator.id is required`);
  if (observation.source.kind === "jev") {
    exactlyKeys(observation.source.evaluator, new Set(["id", "provider", "model", "tool", "toolVersion"]), `${label}.source.evaluator`);
    for (const key of ["provider", "model", "tool", "toolVersion"]) requireValue(typeof observation.source.evaluator[key] === "string" && observation.source.evaluator[key].length > 0, `${label}.source.evaluator.${key} is required`);
  } else {
    exactlyKeys(observation.source.evaluator, new Set(["id", "label"]), `${label}.source.evaluator`);
    requireValue(typeof observation.source.evaluator.label === "string" && observation.source.evaluator.label.length > 0, `${label}.source.evaluator.label is required`);
  }
  requireValue(typeof observation.observedAt === "string" && !Number.isNaN(Date.parse(observation.observedAt)), `${label}.observedAt is invalid`);
  exactlyKeys(observation.evidenceAdapter, new Set(["shape", "version"]), `${label}.evidenceAdapter`);
  requireValue(observation.evidenceAdapter.shape === axisSet.adapter.shape && observation.evidenceAdapter.version === 1, `${label}.evidenceAdapter does not match the axis set`);
  requireValue(Array.isArray(observation.axes) && observation.axes.length === axisSet.axes.length, `${label}.axes must contain every rubric axis`);
  for (const [index, result] of observation.axes.entries()) {
    const axis = axisSet.axes[index];
    const resultLabel = `${label}.axes[${index}]`;
    exactlyKeys(result, new Set(["axisId", "levelId", "position", "confidence", "distribution", "evidence", "note"]), resultLabel);
    requireValue(result.axisId === axis.id, `${resultLabel}.axisId or order does not match the axis set`);
    const levelIds = axis.levels.map((level) => level.id);
    requireValue(levelIds.includes(result.levelId), `${resultLabel}.levelId is unknown`);
    requireValue(Array.isArray(result.evidence) && result.evidence.length > 0, `${resultLabel}.evidence must not be empty`);
    for (const [evidenceIndex, reference] of result.evidence.entries()) {
      exactlyKeys(reference, new Set(["path", "sha256"]), `${resultLabel}.evidence[${evidenceIndex}]`);
      contained(path.join("/", "dish"), reference.path, `${resultLabel}.evidence[${evidenceIndex}].path`);
      requireValue(reference.sha256 === null || HASH.test(reference.sha256), `${resultLabel}.evidence[${evidenceIndex}].sha256 is invalid`);
    }
    if (observation.source.kind === "jev") {
      requireValue(typeof result.position === "number" && Number.isFinite(result.position) && result.position >= 0 && result.position <= axis.levels.length - 1, `${resultLabel}.position is invalid`);
      requireValue(typeof result.confidence === "number" && result.confidence >= 0 && result.confidence <= 1, `${resultLabel}.confidence is invalid`);
      validateDistribution(result.distribution, levelIds, `${resultLabel}.distribution`);
    } else {
      requireValue(result.position === null && result.confidence === null && result.distribution === null, `${resultLabel} human observations must not fabricate model probabilities`);
      if (result.note !== undefined) requireValue(typeof result.note === "string" && result.note.length > 0, `${resultLabel}.note is invalid`);
    }
  }
  if (observation.usage !== undefined) {
    exactlyKeys(observation.usage, new Set(["inputTokens", "outputTokens"]), `${label}.usage`);
    for (const value of Object.values(observation.usage)) requireValue(Number.isInteger(value) && value >= 0, `${label}.usage is invalid`);
  }
  return observation;
}

export async function loadObservations(repoRoot, { dishes, axisSets, visibleDishIds } = {}) {
  const allDishes = dishes ?? await (await import("./registry.mjs")).loadDishes(repoRoot);
  const allAxisSets = axisSets ?? await loadAxisSets(repoRoot);
  const menus = await loadMenus(repoRoot);
  const observations = [];
  const ids = new Set();
  for (const filename of await jsonFiles(path.join(repoRoot, "observations"))) {
    const observation = validateObservation(await readJson(filename), { dishes: allDishes, axisSets: allAxisSets, menus });
    requireValue(path.basename(filename) === `${observation.id}.json`, `Observation filename does not match id: ${filename}`);
    requireValue(!ids.has(observation.id), `Duplicate observation id: ${observation.id}`);
    ids.add(observation.id);
    if (!visibleDishIds || visibleDishIds.has(observation.dishId)) observations.push(observation);
  }
  return observations.sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id));
}

function selectedLevel(axis, probabilities) {
  let bestIndex = 0;
  for (let index = 1; index < probabilities.length; index += 1) if (probabilities[index] > probabilities[bestIndex]) bestIndex = index;
  return axis.levels[bestIndex].id;
}

export function observationFromJev({ id, dish, context, axisSet, evaluator, observedAt, evidence, response }) {
  const answers = response?.data?.answers ?? response?.answers;
  const model = response?.data?.model ?? response?.model;
  const usage = response?.data?.usage ?? response?.usage;
  requireValue(plainObject(answers) && typeof model === "string", "Jev response is missing model or answers");
  const axes = axisSet.axes.map((axis) => {
    const answer = answers[axis.id];
    requireValue(answer?.type === "score" && plainObject(answer.probabilities), `Jev response is missing ordered-level answer ${axis.id}`);
    const probabilities = axis.levels.map((_, index) => Number(answer.probabilities[String(index)]));
    requireValue(probabilities.every(Number.isFinite), `Jev answer ${axis.id} has incomplete probabilities`);
    return {
      axisId: axis.id,
      levelId: selectedLevel(axis, probabilities),
      position: answer.score,
      confidence: answer.confidence,
      distribution: axis.levels.map((level, index) => ({ levelId: level.id, probability: probabilities[index] })),
      evidence,
    };
  });
  return {
    schemaVersion: 1,
    id,
    dishId: dish.id,
    dishHash: dish.dishHash,
    context,
    axisSet: { id: axisSet.id, version: axisSet.version, hash: axisSet.rubricHash },
    source: { kind: "jev", evaluator: { ...evaluator, model } },
    observedAt,
    evidenceAdapter: { shape: axisSet.adapter.shape, version: 1 },
    axes,
    ...(usage ? { usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } } : {}),
  };
}

function executeJev({ command, stateFile, questionsFile, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["ask", "ignored", "--state-file", stateFile, "--questions-file", questionsFile, "--format", "json", "--full-output"], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-1048576); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-65536); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Jev failed (${code ?? signal}): ${stderr.trim() || "no diagnostic"}`));
      try {
        const response = JSON.parse(stdout);
        if (response.ok === false) reject(new Error(`Jev returned an error: ${JSON.stringify(response.error)}`));
        else resolve(response);
      } catch (error) { reject(new Error(`Jev returned invalid JSON: ${error.message}`, { cause: error })); }
    });
  });
}

function observationId(dish, axisSet, observedAt) {
  const stamp = observedAt.replace(/[-:.TZ]/gu, "");
  const suffix = hashCanonical({ dishHash: dish.dishHash, rubricHash: axisSet.rubricHash, observedAt }).slice("sha256:".length, "sha256:".length + 10);
  return `observation_${dish.id.slice("dish_".length)}_${axisSet.id}_${stamp}_${suffix}`;
}

export async function evaluateDishWithJev(repoRoot, {
  dishId, axisSetId, axisSetVersion, context, evaluatorProvider, evaluatorId = "jev-system-one", command = "jev",
  now = new Date(), timeoutMs = 60000, execute = false, run = executeJev, toolVersion,
} = {}) {
  requireValue(axisSetId && axisSetVersion, "An explicit axisSetId and axisSetVersion are required; there is no implicit rubric default");
  const [{ loadDishes }, axisSets, menus] = await Promise.all([import("./registry.mjs"), loadAxisSets(repoRoot), loadMenus(repoRoot)]);
  const dishes = await loadDishes(repoRoot);
  const dish = dishes.find((candidate) => candidate.id === dishId);
  requireValue(dish, `Unknown Dish: ${dishId}`);
  const axisSet = axisSets.find((candidate) => candidate.id === axisSetId && candidate.version === axisSetVersion);
  requireValue(axisSet, `Unknown axis set version: ${axisSetId}@${axisSetVersion}`);
  validateContext(context, dish, menus, "observation context");
  requireValue(axisSet.contexts.some((candidate) => candidate.kind === context.kind && candidate.id === context.id), `Axis set ${axisSetId}@${axisSetVersion} is not selectable for ${context.kind} ${context.id}`);
  const adapted = await loadDishObservationEvidence(repoRoot, dish, axisSet);
  const plan = {
    dish: { id: dish.id, hash: dish.dishHash },
    context,
    axisSet: { id: axisSet.id, version: axisSet.version, hash: axisSet.rubricHash },
    evidenceAdapter: { shape: axisSet.adapter.shape, version: 1 },
    evidence: adapted.evidence,
    questions: questionsForAxisSet(axisSet),
  };
  if (!execute) return { mode: "dry-run", plan };
  requireValue(evaluatorProvider, "evaluatorProvider is required for an inspectable evaluator identity");
  const observedAt = new Date(now).toISOString();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "taste-jev-"));
  try {
    const stateFile = path.join(temporary, "state.json");
    const questionsFile = path.join(temporary, "questions.json");
    await Promise.all([
      writeFile(stateFile, `${JSON.stringify({ dish: plan.dish, context, evidence: adapted.state })}\n`, { mode: 0o600 }),
      writeFile(questionsFile, `${JSON.stringify(plan.questions)}\n`, { mode: 0o600 }),
    ]);
    const response = await run({ command, stateFile, questionsFile, timeoutMs });
    const versionResult = toolVersion ?? await new Promise((resolve) => {
      const child = spawn(command, ["--version"], { shell: false, stdio: ["ignore", "pipe", "ignore"] });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.once("error", () => resolve("unknown"));
      child.once("close", (code) => resolve(code === 0 ? output.trim() : "unknown"));
    });
    const id = observationId(dish, axisSet, observedAt);
    const observation = observationFromJev({
      id, dish, context, axisSet, observedAt, evidence: adapted.evidence, response,
      evaluator: { id: evaluatorId, provider: evaluatorProvider, tool: "jevon", toolVersion: versionResult },
    });
    validateObservation(observation, { dishes, axisSets, menus });
    const output = path.join(repoRoot, "observations", `${id}.json`);
    requireValue(!await pathExists(output), `Observation already exists: ${id}`);
    await writeJsonAtomic(output, observation);
    return { mode: "executed", output: path.relative(repoRoot, output), observation };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
