import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, loadCatalog, sha256 } from "./catalog.mjs";
import { assertRelativePath, within } from "./files.mjs";
import { loadDishes } from "./registry.mjs";

const TEXT_EXTENSIONS = new Set([".css", ".csv", ".html", ".htm", ".js", ".json", ".jsx", ".md", ".mjs", ".svg", ".text", ".txt", ".ts", ".tsx", ".vue", ".xml", ".yaml", ".yml"]);
const RECIPE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TURN_ROLES = new Set(["prompt", "follow-up", "correction", "mode-transition"]);
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const saveLocks = new Map();

export class RecipeBookError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function invalid(message) {
  throw new RecipeBookError("VALIDATION", message);
}

function asRecipeId(value) {
  if (typeof value !== "string" || !RECIPE_ID.test(value)) invalid("recipeId must be a lowercase hyphenated identifier");
  return value;
}

function textValue(value, label, maximum) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    invalid(`${label} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function authoredDefinition(record) {
  const recipe = { ...record };
  delete recipe.recipeHash;
  delete recipe.fixtureHashes;
  delete recipe.sourcePath;
  return recipe;
}

function publicDefinition(record) {
  const recipe = authoredDefinition(record);
  recipe.recipeHash = record.recipeHash;
  recipe.setup = {
    ...recipe.setup,
    fixtures: (recipe.setup?.fixtures ?? []).filter((fixture) => fixture.public === true),
  };
  return recipe;
}

async function regularContainedFile(directory, relative, label) {
  let portable;
  let filename;
  try {
    portable = assertRelativePath(relative, label);
    filename = within(directory, portable, label);
  } catch {
    throw new RecipeBookError("UNSAFE_PATH", `${label} must be a contained POSIX-relative path`);
  }
  let info;
  let current = path.resolve(directory);
  try {
    for (const part of portable.split("/")) {
      current = path.join(current, part);
      info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error("symlink");
    }
  } catch {
    throw new RecipeBookError("UNSAFE_PATH", `${label} is not a readable regular file`);
  }
  if (!info.isFile()) {
    throw new RecipeBookError("UNSAFE_PATH", `${label} must be a regular non-symlink file`);
  }
  return filename;
}

async function sourceForRecord(root, record) {
  const sourcePath = assertRelativePath(record.sourcePath, "recipe source path");
  const recipePath = await regularContainedFile(root, sourcePath, "recipe source path");
  const recipeDirectory = path.dirname(recipePath);
  const sourceBytes = await readFile(recipePath);
  const fixtures = [];
  for (const fixture of record.setup?.fixtures ?? []) {
    if (!fixture || typeof fixture.id !== "string" || !RECIPE_ID.test(fixture.id)) {
      throw new RecipeBookError("UNSAFE_PATH", `Fixture for ${record.id} has an unsafe id`);
    }
    const filename = await regularContainedFile(recipeDirectory, fixture.path, `fixture ${fixture.id}`);
    const bytes = await readFile(filename);
    fixtures.push({ fixture, filename, bytes });
  }
  return { recipePath, recipeDirectory, sourceBytes, fixtures };
}

function fileHash(sourcePath, sourceBytes, fixtures) {
  const parts = [Buffer.from(`${sourcePath}\0`), sourceBytes];
  for (const { fixture, bytes } of fixtures) parts.push(Buffer.from(`\0${fixture.id}\0${fixture.path}\0`), bytes);
  return sha256(Buffer.concat(parts));
}

function fixtureText(fixture, bytes) {
  return TEXT_EXTENSIONS.has(path.posix.extname(fixture.path).toLowerCase()) ? bytes.toString("utf8") : null;
}

function isTextFixture(fixture) {
  return TEXT_EXTENSIONS.has(path.posix.extname(fixture.path).toLowerCase());
}

async function bookEntry(root, record) {
  const source = await sourceForRecord(root, record);
  const visibleFixtures = source.fixtures
    .filter(({ fixture }) => fixture.public === true)
    .map(({ fixture, bytes }) => ({
      id: fixture.id,
      path: fixture.path,
      mountAs: fixture.mountAs,
      mediaType: fixture.mediaType,
      ...(fixture.editable === true ? { editable: true } : {}),
      text: fixtureText(fixture, bytes),
    }));
  return {
    recipe: publicDefinition(record),
    sourcePath: record.sourcePath,
    fileHash: fileHash(record.sourcePath, source.sourceBytes, source.fixtures),
    dishCount: 0,
    fixtures: visibleFixtures,
  };
}

/** Current authoring definitions, kept separate from immutable executed Dishes. */
export async function buildRecipeBook(repoRoot) {
  const root = path.resolve(repoRoot);
  const [catalog, dishes] = await Promise.all([loadCatalog(root), loadDishes(root)]);
  const dishCounts = new Map();
  for (const dish of dishes) dishCounts.set(dish.recipe.id, (dishCounts.get(dish.recipe.id) ?? 0) + 1);
  const recipes = [];
  let archivedCount = 0;
  for (const record of catalog.recipes) {
    if (record.status === "hidden") {
      archivedCount += 1;
      continue;
    }
    const entry = await bookEntry(root, record);
    entry.dishCount = dishCounts.get(record.id) ?? 0;
    recipes.push(entry);
  }
  return { schemaVersion: 1, recipes, archivedCount };
}

function validateTurns(turns) {
  if (!Array.isArray(turns) || turns.length === 0 || turns.length > 40) invalid("turns must be a non-empty array of at most 40 turns");
  const ids = new Set();
  return turns.map((turn, index) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) invalid(`turn ${index + 1} must be an object`);
    if (typeof turn.id !== "string" || !RECIPE_ID.test(turn.id) || ids.has(turn.id)) invalid(`turn ${index + 1} has an invalid or duplicate id`);
    if (!TURN_ROLES.has(turn.role)) invalid(`turn ${index + 1} has an invalid role`);
    ids.add(turn.id);
    return { id: turn.id, role: turn.role, content: textValue(turn.content, `turn ${index + 1} content`, 50000) };
  });
}

function validateUpdates(updates, record, source) {
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) invalid("updates must be an object");
  const permitted = new Set(["title", "summary", "setupInstructions", "turns", "fixtureEdits"]);
  const keys = Object.keys(updates);
  if (keys.length === 0 || keys.some((key) => !permitted.has(key))) invalid("updates contains an unsupported field");
  const next = JSON.parse(JSON.stringify(authoredDefinition(record)));
  let executionChanged = false;
  let recipeChanged = false;
  if (Object.hasOwn(updates, "title")) {
    next.title = textValue(updates.title, "title", 100);
    if (next.title.length < 4) invalid("title must be at least 4 characters");
    recipeChanged ||= next.title !== record.title;
  }
  if (Object.hasOwn(updates, "summary")) {
    next.summary = textValue(updates.summary, "summary", 300);
    if (next.summary.length < 12) invalid("summary must be at least 12 characters");
    recipeChanged ||= next.summary !== record.summary;
  }
  if (Object.hasOwn(updates, "setupInstructions")) {
    next.setup.instructions = textValue(updates.setupInstructions, "setupInstructions", 50000);
    executionChanged ||= next.setup.instructions !== record.setup.instructions;
    recipeChanged ||= next.setup.instructions !== record.setup.instructions;
  }
  if (Object.hasOwn(updates, "turns")) {
    next.turns = validateTurns(updates.turns);
    const changed = canonicalJson(next.turns) !== canonicalJson(record.turns);
    executionChanged ||= changed;
    recipeChanged ||= changed;
  }
  const fixtureEdits = [];
  if (Object.hasOwn(updates, "fixtureEdits")) {
    if (!Array.isArray(updates.fixtureEdits) || updates.fixtureEdits.length > 40) invalid("fixtureEdits must be an array of at most 40 edits");
    const byId = new Map(source.fixtures.filter(({ fixture }) => fixture.public === true).map((item) => [item.fixture.id, item]));
    const seen = new Set();
    for (const edit of updates.fixtureEdits) {
      if (!edit || typeof edit !== "object" || Array.isArray(edit) || typeof edit.id !== "string" || seen.has(edit.id)) invalid("fixtureEdits contains an invalid or duplicate id");
      const fixture = byId.get(edit.id);
      if (!fixture) invalid(`fixtureEdits references an unknown public fixture: ${edit.id}`);
      if (!isTextFixture(fixture.fixture)) invalid(`fixtureEdits cannot edit binary fixture: ${edit.id}`);
      seen.add(edit.id);
      const text = textValue(edit.text, `fixture ${edit.id}`, 1_000_000);
      if (path.posix.extname(fixture.fixture.path).toLowerCase() === ".json") {
        try { JSON.parse(text); } catch { invalid(`fixture ${edit.id} must contain valid JSON`); }
      }
      if (!Buffer.from(text).equals(fixture.bytes)) fixtureEdits.push({ ...fixture, text });
    }
    if (fixtureEdits.length) {
      executionChanged = true;
      recipeChanged = true;
    }
  }
  return { next, fixtureEdits, executionChanged, recipeChanged };
}

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version ?? "");
  if (!match) throw new RecipeBookError("VALIDATION", "recipe version must use major.minor.patch before execution-affecting edits");
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

async function replaceCoherently(changes) {
  const staged = [];
  try {
    for (const change of changes) {
      const temporary = `${change.filename}.recipe-book-${process.pid}-${Date.now()}-${staged.length}`;
      await writeFile(temporary, change.bytes, { flag: "wx" });
      staged.push({ ...change, temporary });
    }
  } catch (error) {
    await Promise.all(staged.map(({ temporary }) => rm(temporary, { force: true })));
    throw error;
  }
  const replaced = [];
  try {
    for (const change of staged) {
      const info = await lstat(change.filename);
      if (!info.isFile() || info.isSymbolicLink()) throw new RecipeBookError("UNSAFE_PATH", "A recipe source changed into an unsafe file during save");
      await rename(change.temporary, change.filename);
      replaced.push(change);
    }
  } catch (error) {
    await Promise.all(replaced.map((change) => writeFile(change.filename, change.original)));
    await Promise.all(staged.filter((change) => !replaced.includes(change)).map(({ temporary }) => rm(temporary, { force: true })));
    throw error;
  }
}

async function saveRecipeEditsUnlocked(repoRoot, recipeId, expectedHash, updates) {
  const root = path.resolve(repoRoot);
  const catalog = await loadCatalog(root);
  const record = catalog.recipes.find((candidate) => candidate.id === recipeId);
  if (!record) throw new RecipeBookError("NOT_FOUND", `Unknown recipe: ${recipeId}`);
  if (record.status === "hidden") throw new RecipeBookError("ARCHIVED", "Archived recipes cannot be edited");
  const source = await sourceForRecord(root, record);
  if (fileHash(record.sourcePath, source.sourceBytes, source.fixtures) !== expectedHash) {
    throw new RecipeBookError("CONFLICT", "This recipe changed since it was opened; reload before saving");
  }
  const { next, fixtureEdits, executionChanged, recipeChanged } = validateUpdates(updates, record, source);
  if (executionChanged) next.version = bumpPatch(record.version);
  if (!recipeChanged) {
    const book = await buildRecipeBook(root);
    return book.recipes.find((candidate) => candidate.recipe.id === recipeId);
  }
  const changes = [
    { filename: source.recipePath, original: source.sourceBytes, bytes: Buffer.from(`${JSON.stringify(next, null, 2)}\n`) },
    ...fixtureEdits.map((edit) => ({ filename: edit.filename, original: edit.bytes, bytes: Buffer.from(edit.text) })),
  ];
  await replaceCoherently(changes);
  const book = await buildRecipeBook(root);
  const entry = book.recipes.find((candidate) => candidate.recipe.id === recipeId);
  return entry;
}

async function withRecipeSaveLock(key, operation) {
  const previous = saveLocks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  saveLocks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (saveLocks.get(key) === current) saveLocks.delete(key);
  }
}

export async function saveRecipeEdits(repoRoot, { recipeId, expectedHash, updates } = {}) {
  const root = path.resolve(repoRoot);
  asRecipeId(recipeId);
  if (typeof expectedHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(expectedHash)) invalid("expectedHash must be a recipe file hash");
  return withRecipeSaveLock(`${root}\0${recipeId}`, () => saveRecipeEditsUnlocked(root, recipeId, expectedHash, updates));
}

function isLoopbackHost(value) {
  const host = value?.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function localRequestOrigin(req) {
  const host = req.headers?.host;
  let hostUrl;
  const protocol = req.socket?.encrypted ? "https" : "http";
  try { hostUrl = new URL(`${protocol}://${host}`); } catch { return null; }
  if (!isLoopbackHost(hostUrl.hostname)) return null;
  return hostUrl.origin;
}

function validLocalMutation(req) {
  const requestOrigin = localRequestOrigin(req);
  if (!requestOrigin) return false;
  const origin = req.headers?.origin;
  if (typeof origin !== "string") return false;
  let originUrl;
  try { originUrl = new URL(origin); } catch { return false; }
  return originUrl.origin === requestOrigin;
}

async function readRequestJson(req) {
  const type = req.headers?.["content-type"] ?? "";
  if (!/^application\/json(?:\s*;|$)/iu.test(type)) throw new RecipeBookError("UNSUPPORTED_MEDIA_TYPE", "PATCH requests must use application/json");
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw new RecipeBookError("PAYLOAD_TOO_LARGE", "Request body exceeds 2 MB");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new RecipeBookError("INVALID_JSON", "Request body must contain valid JSON"); }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader?.("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/** Local-development middleware. PATCH is deliberately loopback + same-origin only. */
export function recipeBookMiddleware(repoRoot) {
  return async function recipeBookHandler(req, res, next = () => {}) {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && requestUrl.pathname === "/api/recipes") {
      if (!localRequestOrigin(req)) {
        sendJson(res, 403, { error: { code: "FORBIDDEN", message: "Recipe book is available only from loopback hosts" } });
        return;
      }
      try { sendJson(res, 200, { book: await buildRecipeBook(repoRoot), writable: true }); }
      catch { sendJson(res, 500, { error: { code: "INTERNAL", message: "Could not build recipe book" } }); }
      return;
    }
    const match = req.method === "PATCH" && /^\/api\/recipes\/([^/]+)$/u.exec(requestUrl.pathname);
    if (!match) return next();
    if (!validLocalMutation(req)) {
      sendJson(res, 403, { error: { code: "FORBIDDEN", message: "Recipe edits require a loopback same-origin request" } });
      return;
    }
    try {
      const body = await readRequestJson(req);
      const entry = await saveRecipeEdits(repoRoot, { ...body, recipeId: decodeURIComponent(match[1]) });
      sendJson(res, 200, { entry });
    } catch (error) {
      const known = error instanceof RecipeBookError;
      const status = error?.code === "CONFLICT" ? 409 : error?.code === "NOT_FOUND" ? 404 : error?.code === "ARCHIVED" ? 403 : error?.code === "PAYLOAD_TOO_LARGE" ? 413 : error?.code === "UNSUPPORTED_MEDIA_TYPE" ? 415 : known ? 400 : 500;
      sendJson(res, status, { error: { code: known ? error.code : "INTERNAL", message: known ? error.message : "Could not save recipe edits" } });
    }
  };
}
