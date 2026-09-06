import type { Recipe, RecipeTurn } from "../types";
import type { RecipeBookEntry, RecipeEdits, RecipeInput } from "./recipe-book";

const API_ORIGIN = "https://api.github.com";
const REPOSITORY = "beejsbj/tasting-kitchen";
const RECIPE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TURN_ROLES = new Set(["prompt", "follow-up", "correction", "mode-transition"]);
const TEXT_EXTENSIONS = new Set([".css", ".csv", ".html", ".htm", ".js", ".json", ".jsx", ".md", ".mjs", ".svg", ".text", ".txt", ".ts", ".tsx", ".vue", ".xml", ".yaml", ".yml"]);
const encoder = new TextEncoder();

type JsonObject = Record<string, unknown>;
type TreeEntry = { path: string; mode: string; type: string; sha: string };
type LoadedFixture = { fixture: JsonObject; path: string; entry: TreeEntry; bytes: Uint8Array };
type Head = { sha: string; treeSha: string; tree: Map<string, TreeEntry> };

export class RecipeSaveError extends Error {}

function fail(message: string): never {
  throw new RecipeSaveError(message);
}

function safeToken(token: string): string {
  if (typeof token !== "string" || token.trim().length === 0) fail("A GitHub token is required.");
  return token.trim();
}

function safeBranch(branch: string): string {
  if (typeof branch !== "string" || branch.length === 0 || branch.length > 250 || branch.includes("\0") || branch.includes("\\") || branch.startsWith("/") || branch.endsWith("/") || branch.split("/").some((part) => part.length === 0 || part === "." || part === ".." || part.endsWith("."))) {
    fail("The GitHub branch name is invalid.");
  }
  return branch;
}

function safeRelativePath(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\") || value.startsWith("/") || value.split("/").some((part) => part.length === 0 || part === "." || part === "..")) {
    fail(`${label} must be a contained POSIX-relative path.`);
  }
  return value;
}

function recipeSourcePath(entry: RecipeBookEntry): string {
  const source = safeRelativePath(entry.sourcePath, "Recipe source path");
  const parts = source.split("/");
  if (parts.length < 5 || parts[0] !== "catalog" || parts[1] !== "recipes" || parts.at(-1) !== "recipe.json" || parts.at(-2) !== entry.recipe.id || !RECIPE_ID.test(entry.recipe.id)) {
    fail("The recipe source path does not match this recipe.");
  }
  return source;
}

function recipeDirectory(sourcePath: string): string {
  return sourcePath.slice(0, sourcePath.lastIndexOf("/"));
}

function fixturePath(sourcePath: string, fixture: JsonObject): string {
  if (typeof fixture.id !== "string" || !RECIPE_ID.test(fixture.id)) fail("A declared fixture has an invalid id.");
  const relative = safeRelativePath(fixture.path, `Fixture ${fixture.id}`);
  return `${recipeDirectory(sourcePath)}/${relative}`;
}

function apiUrl(path: string): string {
  if (path === "/user") return `${API_ORIGIN}/user`;
  return `${API_ORIGIN}/repos/${REPOSITORY}${path}`;
}

async function api(token: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    if (response.status === 401) fail("GitHub rejected the token.");
    if (response.status === 403) fail("GitHub did not allow this action.");
    if (response.status === 404) fail("The configured repository or branch was not found.");
    if (response.status === 409 || response.status === 422) fail("The branch changed while saving; reload and try again.");
    fail("GitHub could not complete the recipe save.");
  }
  try {
    return await response.json();
  } catch {
    fail("GitHub returned an invalid response.");
  }
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid.`);
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label} is invalid.`);
  return value;
}

function decodeBase64(value: string): Uint8Array {
  try {
    const decoded = atob(value.replace(/\s/g, ""));
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    fail("GitHub returned invalid file content.");
  }
}

async function readBlob(token: string, sha: string): Promise<Uint8Array> {
  const response = object(await api(token, `/git/blobs/${encodeURIComponent(sha)}`), "GitHub blob");
  return decodeBase64(string(response.content, "GitHub blob content"));
}

async function readHead(token: string, branch: string): Promise<Head> {
  const ref = object(await api(token, `/git/ref/heads/${encodeURIComponent(branch)}`), "GitHub reference");
  const refObject = object(ref.object, "GitHub reference object");
  const sha = string(refObject.sha, "GitHub reference SHA");
  const commit = object(await api(token, `/git/commits/${encodeURIComponent(sha)}`), "GitHub commit");
  const tree = object(commit.tree, "GitHub commit tree");
  const treeSha = string(tree.sha, "GitHub tree SHA");
  const response = object(await api(token, `/git/trees/${encodeURIComponent(treeSha)}?recursive=1`), "GitHub tree");
  if (response.truncated === true || !Array.isArray(response.tree)) fail("The repository tree is too large to safely save this recipe.");
  const entries = new Map<string, TreeEntry>();
  for (const value of response.tree) {
    const entry = object(value, "GitHub tree entry");
    const path = string(entry.path, "GitHub tree path");
    const mode = string(entry.mode, "GitHub tree mode");
    const type = string(entry.type, "GitHub tree type");
    const entrySha = string(entry.sha, "GitHub tree SHA");
    entries.set(path, { path, mode, type, sha: entrySha });
  }
  return { sha, treeSha, tree: entries };
}

function regularBlob(tree: Map<string, TreeEntry>, path: string, label: string): TreeEntry {
  const entry = tree.get(path);
  if (!entry || entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) fail(`${label} is not a regular file in the current branch.`);
  return entry;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes);
  return `sha256:${hex(new Uint8Array(await crypto.subtle.digest("SHA-256", input as unknown as BufferSource)))}`;
}

async function fileHash(sourcePath: string, source: Uint8Array, fixtures: LoadedFixture[]): Promise<string> {
  const parts = [encoder.encode(`${sourcePath}\0`), source];
  for (const { fixture, bytes } of fixtures) parts.push(encoder.encode(`\0${fixture.id}\0${fixture.path}\0`), bytes);
  return sha256(joinBytes(parts));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertJsonValue(value: unknown, seen = new Set<unknown>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("Recipe data contains a non-finite number.");
    return;
  }
  if (typeof value !== "object" || value === undefined) fail("Recipe data is not JSON.");
  if (seen.has(value)) fail("Recipe data is circular.");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, seen);
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail("Recipe data is not plain JSON.");
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || typeof item === "function" || typeof item === "symbol") fail(`Recipe data has an invalid value at ${key}.`);
      assertJsonValue(item, seen);
    }
  }
  seen.delete(value);
}

function canonicalJson(value: unknown): string {
  assertJsonValue(value);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as JsonObject;
  return `{${Object.keys(record).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function normalizeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) fail("Recipe harness capabilities are invalid.");
  return [...new Set(value)].sort(compareText);
}

async function recipeHash(recipe: JsonObject, fixtures: LoadedFixture[]): Promise<string> {
  const fixtureHashes: Record<string, string> = {};
  for (const fixture of fixtures) fixtureHashes[string(fixture.fixture.id, "Fixture id")] = await sha256(fixture.bytes);
  const setup = object(recipe.setup, "Recipe setup");
  const harness = object(recipe.harness, "Recipe harness");
  const validation = object(recipe.validation, "Recipe validation");
  const fixtureDefinitions = Array.isArray(setup.fixtures) ? setup.fixtures : fail("Recipe fixtures are invalid.");
  const checks = Array.isArray(validation.checks) ? validation.checks : [];
  const executionFixtures = fixtureDefinitions.map((fixture) => {
    const record = object(fixture, "Recipe fixture");
    const id = string(record.id, "Recipe fixture id");
    const hash = fixtureHashes[id];
    if (!hash) fail(`Missing fixture content for ${id}.`);
    return { ...record, sha256: hash };
  });
  const hashInput: JsonObject = {
    kind: recipe.kind,
    harness: { ...harness, capabilities: normalizeCapabilities(harness.capabilities) },
    setup: { instructions: setup.instructions, fixtures: executionFixtures },
    turns: recipe.turns,
    output: recipe.output,
    validation: { mode: validation.mode, checks: checks.filter((check) => object(check, "Recipe check").required) },
  };
  if (Object.hasOwn(recipe, "presentation")) hashInput.presentation = recipe.presentation;
  return sha256(encoder.encode(canonicalJson(hashInput)));
}

function textValue(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) fail(`${label} must be a non-empty string of at most ${maximum} characters.`);
  return value;
}

function validateTurns(turns: unknown): RecipeTurn[] {
  if (!Array.isArray(turns) || turns.length === 0 || turns.length > 40) fail("turns must be a non-empty array of at most 40 turns.");
  const ids = new Set<string>();
  const validated = turns.map((turn, index) => {
    const value = object(turn, `Turn ${index + 1}`);
    const id = string(value.id, `Turn ${index + 1} id`);
    const role = string(value.role, `Turn ${index + 1} role`);
    if (!RECIPE_ID.test(id) || ids.has(id) || !TURN_ROLES.has(role)) fail(`Turn ${index + 1} has an invalid id or role.`);
    ids.add(id);
    return { id, role: role as RecipeTurn["role"], content: textValue(value.content, `Turn ${index + 1} content`, 50000) };
  });
  if (validated[0].role !== "prompt") fail("The first turn must have the prompt role.");
  return validated;
}

function isTextFixture(fixture: JsonObject): boolean {
  const pathname = string(fixture.path, "Fixture path");
  const extension = pathname.slice(pathname.lastIndexOf(".")).toLowerCase();
  return TEXT_EXTENSIONS.has(extension);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function clone(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function authoredDefinition(record: JsonObject): JsonObject {
  const copy = { ...record };
  delete copy.recipeHash;
  delete copy.fixtureHashes;
  delete copy.sourcePath;
  return copy;
}

function bumpPatch(version: unknown): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(typeof version === "string" ? version : "");
  if (!match) fail("Recipe version must use major.minor.patch before execution-affecting edits.");
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function validateUpdates(updates: RecipeEdits, record: JsonObject, fixtures: LoadedFixture[]): { next: JsonObject; fixtureEdits: Array<LoadedFixture & { text: string }>; executionChanged: boolean; recipeChanged: boolean } {
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) fail("updates must be an object.");
  const permitted = new Set(["title", "summary", "setupInstructions", "turns", "fixtureEdits"]);
  const keys = Object.keys(updates);
  if (keys.length === 0 || keys.some((key) => !permitted.has(key))) fail("updates contains an unsupported field.");
  const next = clone(authoredDefinition(record));
  let executionChanged = false;
  let recipeChanged = false;
  if (Object.hasOwn(updates, "title")) {
    next.title = textValue(updates.title, "title", 100);
    if ((next.title as string).length < 4) fail("title must be at least 4 characters.");
    recipeChanged ||= next.title !== record.title;
  }
  if (Object.hasOwn(updates, "summary")) {
    next.summary = textValue(updates.summary, "summary", 300);
    if ((next.summary as string).length < 12) fail("summary must be at least 12 characters.");
    recipeChanged ||= next.summary !== record.summary;
  }
  if (Object.hasOwn(updates, "setupInstructions")) {
    const setup = object(next.setup, "Recipe setup");
    const prior = object(record.setup, "Recipe setup");
    setup.instructions = textValue(updates.setupInstructions, "setupInstructions", 50000);
    const changed = setup.instructions !== prior.instructions;
    executionChanged ||= changed;
    recipeChanged ||= changed;
  }
  if (Object.hasOwn(updates, "turns")) {
    next.turns = validateTurns(updates.turns);
    const changed = !sameJson(next.turns, record.turns);
    executionChanged ||= changed;
    recipeChanged ||= changed;
  }
  const fixtureEdits: Array<LoadedFixture & { text: string }> = [];
  if (Object.hasOwn(updates, "fixtureEdits")) {
    if (!Array.isArray(updates.fixtureEdits) || updates.fixtureEdits.length > 40) fail("fixtureEdits must be an array of at most 40 edits.");
    const byId = new Map(fixtures.filter(({ fixture }) => fixture.public === true).map((item) => [item.fixture.id as string, item]));
    const seen = new Set<string>();
    for (const edit of updates.fixtureEdits) {
      const value = object(edit, "Fixture edit");
      const id = string(value.id, "Fixture edit id");
      const fixture = byId.get(id);
      if (seen.has(id) || !fixture) fail(`fixtureEdits references an unknown public fixture: ${id}.`);
      if (!isTextFixture(fixture.fixture)) fail(`fixtureEdits cannot edit binary fixture: ${id}.`);
      seen.add(id);
      const text = textValue(value.text, `Fixture ${id}`, 1_000_000);
      if (String(fixture.fixture.path).toLowerCase().endsWith(".json")) {
        try { JSON.parse(text); } catch { fail(`Fixture ${id} must contain valid JSON.`); }
      }
      if (!sameBytes(encoder.encode(text), fixture.bytes)) fixtureEdits.push({ ...fixture, text });
    }
    if (fixtureEdits.length > 0) {
      executionChanged = true;
      recipeChanged = true;
    }
  }
  return { next, fixtureEdits, executionChanged, recipeChanged };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function publicEntry(record: JsonObject, sourcePath: string, source: Uint8Array, fixtures: LoadedFixture[], dishCount: number): Promise<RecipeBookEntry> {
  const recipe = authoredDefinition(record);
  const setup = object(recipe.setup, "Recipe setup");
  const visible = fixtures.filter(({ fixture }) => fixture.public === true);
  recipe.setup = {
    ...setup,
    fixtures: (Array.isArray(setup.fixtures) ? setup.fixtures : []).filter((fixture) => object(fixture, "Recipe fixture").public === true),
  };
  return Promise.all([fileHash(sourcePath, source, fixtures), recipeHash(record, fixtures)]).then(([currentFileHash, currentRecipeHash]) => {
    recipe.recipeHash = currentRecipeHash;
    const inputs: RecipeInput[] = visible.map(({ fixture, bytes }) => ({
      id: string(fixture.id, "Fixture id"),
      path: string(fixture.path, "Fixture path"),
      mountAs: string(fixture.mountAs, "Fixture mount path"),
      mediaType: string(fixture.mediaType, "Fixture media type"),
      ...(fixture.editable === true ? { editable: true } : {}),
      text: isTextFixture(fixture) ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : null,
    }));
    return { recipe: recipe as Recipe, sourcePath, fileHash: currentFileHash, dishCount, fixtures: inputs };
  });
}

async function currentRecipe(token: string, entry: RecipeBookEntry, branch: string): Promise<{ head: Head; sourcePath: string; sourceEntry: TreeEntry; source: Uint8Array; record: JsonObject; fixtures: LoadedFixture[] }> {
  const sourcePath = recipeSourcePath(entry);
  const head = await readHead(token, branch);
  const sourceEntry = regularBlob(head.tree, sourcePath, "Recipe source");
  const source = await readBlob(token, sourceEntry.sha);
  let record: JsonObject;
  try {
    record = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source)), "Recipe source");
  } catch (error) {
    if (error instanceof RecipeSaveError) throw error;
    fail("The current recipe file is not valid JSON.");
  }
  if (record.id !== entry.recipe.id || !RECIPE_ID.test(String(record.id)) || record.status === "hidden") fail("This recipe is no longer available for editing.");
  const setup = object(record.setup, "Recipe setup");
  if (!Array.isArray(setup.fixtures)) fail("Recipe fixtures are invalid.");
  const fixtures = await Promise.all(setup.fixtures.map(async (definition) => {
    const fixture = object(definition, "Recipe fixture");
    const path = fixturePath(sourcePath, fixture);
    const treeEntry = regularBlob(head.tree, path, `Fixture ${fixture.id}`);
    return { fixture, path, entry: treeEntry, bytes: await readBlob(token, treeEntry.sha) };
  }));
  return { head, sourcePath, sourceEntry, source, record, fixtures };
}

/** Confirm that the supplied in-memory token can read this fixed repository branch. */
export async function verifyGitHubAccess(token: string, branch: string): Promise<{ login: string }> {
  const accessToken = safeToken(token);
  const safe = safeBranch(branch);
  const userResponse = object(await api(accessToken, "/user"), "GitHub user");
  const login = string(userResponse.login, "GitHub user login");
  const repository = object(await api(accessToken, ""), "GitHub repository");
  if (object(repository.permissions, "GitHub repository permissions").push !== true) fail("This GitHub token cannot write to the Recipe Book repository.");
  await api(accessToken, `/git/ref/heads/${encodeURIComponent(safe)}`);
  return { login };
}

/** Read the current authoring definition from the selected branch without changing local drafts. */
export async function loadRecipeFromGitHub({ token, branch, entry }: { token: string; branch: string; entry: RecipeBookEntry }): Promise<RecipeBookEntry> {
  const current = await currentRecipe(safeToken(token), entry, safeBranch(branch));
  return publicEntry(current.record, current.sourcePath, current.source, current.fixtures, entry.dishCount);
}

/** Save the current recipe definition and its edited public text fixtures in one Git commit. */
export async function saveRecipeViaGitHub({ token, branch, entry, updates }: { token: string; branch: string; entry: RecipeBookEntry; updates: RecipeEdits }): Promise<RecipeBookEntry> {
  const accessToken = safeToken(token);
  const safe = safeBranch(branch);
  const current = await currentRecipe(accessToken, entry, safe);
  if (await fileHash(current.sourcePath, current.source, current.fixtures) !== entry.fileHash) {
    fail("This recipe changed since it was opened; reload before saving.");
  }
  const { next, fixtureEdits, executionChanged, recipeChanged } = validateUpdates(updates, current.record, current.fixtures);
  if (executionChanged) next.version = bumpPatch(current.record.version);
  if (!recipeChanged) return publicEntry(current.record, current.sourcePath, current.source, current.fixtures, entry.dishCount);

  const nextSource = encoder.encode(`${JSON.stringify(next, null, 2)}\n`);
  const changedFixtures = new Map(fixtureEdits.map((edit) => [edit.path, encoder.encode(edit.text)]));
  const nextFixtures = current.fixtures.map((fixture) => ({ ...fixture, bytes: changedFixtures.get(fixture.path) ?? fixture.bytes }));
  const tree = [{ path: current.sourcePath, mode: current.sourceEntry.mode, type: "blob", content: new TextDecoder().decode(nextSource) }, ...fixtureEdits.map((edit) => ({ path: edit.path, mode: edit.entry.mode, type: "blob", content: edit.text }))];
  const createdTree = object(await api(accessToken, "/git/trees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base_tree: current.head.treeSha, tree }) }), "GitHub created tree");
  const treeSha = string(createdTree.sha, "GitHub created tree SHA");
  const createdCommit = object(await api(accessToken, "/git/commits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: `recipe-book: update ${entry.recipe.id}`, tree: treeSha, parents: [current.head.sha] }) }), "GitHub created commit");
  const commitSha = string(createdCommit.sha, "GitHub created commit SHA");
  const latestRef = object(await api(accessToken, `/git/ref/heads/${encodeURIComponent(safe)}`), "GitHub reference");
  if (string(object(latestRef.object, "GitHub reference object").sha, "GitHub reference SHA") !== current.head.sha) fail("The branch changed while saving; reload and try again.");
  await api(accessToken, `/git/refs/heads/${encodeURIComponent(safe)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sha: commitSha, force: false }) });
  return publicEntry(next, current.sourcePath, nextSource, nextFixtures, entry.dishCount);
}
