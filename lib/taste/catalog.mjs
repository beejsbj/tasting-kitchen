import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const CATALOG_DIRECTORY = "catalog";
const RECIPE_FILENAME = "recipe.json";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not support non-finite numbers");
    return;
  }
  if (typeof value !== "object") throw new TypeError(`Canonical JSON does not support ${typeof value} values`);
  if (seen.has(value)) throw new TypeError("Canonical JSON does not support circular values");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, seen);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON only supports plain objects and arrays");
    }
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || typeof item === "function" || typeof item === "symbol") {
        throw new TypeError(`Canonical JSON does not support the value at ${key}`);
      }
      assertJsonValue(item, seen);
    }
  }
  seen.delete(value);
}

function serializeCanonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serializeCanonical).join(",")}]`;
  const keys = Object.keys(value).sort(compareText);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${serializeCanonical(value[key])}`).join(",")}}`;
}

/** Return compact JSON with recursively sorted object keys. Array order is significant. */
export function canonicalJson(value) {
  assertJsonValue(value);
  return serializeCanonical(value);
}

/** Hash bytes or text, using the hash spelling used by recipe and dish manifests. */
export function sha256(value) {
  if (typeof value !== "string" && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError("sha256 expects a string, Buffer, or Uint8Array");
  }
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function hashCanonical(value) {
  return sha256(canonicalJson(value));
}

function normalizeCapabilities(capabilities = []) {
  return [...new Set(capabilities)].sort(compareText);
}

/**
 * Hash the exact requested model/harness configuration, excluding display-only
 * variant fields. Capability order is normalized because it describes a set.
 */
export function computeConfigHash(variant) {
  const executionProfile = variant.executionProfile ? { ...variant.executionProfile } : null;
  if (executionProfile) delete executionProfile.label;
  return hashCanonical({
    provider: variant.provider,
    model: variant.model,
    harness: variant.harness,
    reasoningEffort: variant.reasoningEffort,
    serviceTier: variant.serviceTier,
    personality: variant.personality,
    executionProfile,
    capabilities: normalizeCapabilities(variant.capabilities)
  });
}

function fixtureExecutionInputs(recipe, fixtureHashes) {
  return (recipe.setup?.fixtures ?? []).map((fixture) => {
    const hash = fixtureHashes instanceof Map
      ? fixtureHashes.get(fixture.id)
      : fixtureHashes?.[fixture.id];
    if (!hash) throw new Error(`Missing fixture hash for ${recipe.id}:${fixture.id}`);
    return { ...fixture, sha256: hash };
  });
}

/**
 * Hash only execution-affecting recipe inputs. Display metadata such as title,
 * summary, tags, origin, status, ID, and SemVer deliberately does not affect
 * comparability. Fixture bytes are represented by their hashes.
 */
export function computeRecipeHash(recipe, fixtureHashes = {}) {
  const checks = recipe.validation?.checks ?? [];
  return hashCanonical({
    kind: recipe.kind,
    harness: {
      ...recipe.harness,
      capabilities: normalizeCapabilities(recipe.harness?.capabilities)
    },
    setup: {
      instructions: recipe.setup?.instructions,
      fixtures: fixtureExecutionInputs(recipe, fixtureHashes)
    },
    turns: recipe.turns,
    output: recipe.output,
    validation: {
      mode: recipe.validation?.mode,
      checks: checks.filter((check) => check.required)
    }
  });
}

async function readJson(filename) {
  let text;
  try {
    text = await readFile(filename, "utf8");
  } catch (error) {
    throw new Error(`Cannot read ${filename}: ${error.message}`, { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filename}: ${error.message}`, { cause: error });
  }
}

async function findRecipeFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  entries.sort((left, right) => compareText(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findRecipeFiles(filename));
    else if (entry.isFile() && entry.name === RECIPE_FILENAME) files.push(filename);
  }
  return files;
}

function containedFile(recipeDirectory, relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || relativePath.includes("\0") || relativePath.includes("\\")) {
    throw new Error(`${label} must be a contained POSIX-relative path`);
  }
  const segments = relativePath.split("/");
  if (path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath) || segments.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must be a contained POSIX-relative path`);
  }
  const resolved = path.resolve(recipeDirectory, relativePath);
  if (!resolved.startsWith(`${path.resolve(recipeDirectory)}${path.sep}`)) {
    throw new Error(`${label} escapes its recipe directory`);
  }
  return resolved;
}

async function loadRecipe(repoRoot, filename) {
  const recipe = await readJson(filename);
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe) || typeof recipe.id !== "string") {
    throw new Error(`${filename} is not a recipe object with an id`);
  }
  const recipeDirectory = path.dirname(filename);
  const fixtureHashes = {};
  for (const fixture of recipe.setup?.fixtures ?? []) {
    const fixtureFile = containedFile(recipeDirectory, fixture.path, `${recipe.id}:${fixture.id}`);
    let bytes;
    try {
      bytes = await readFile(fixtureFile);
    } catch (error) {
      throw new Error(`Cannot read fixture ${fixture.path} for ${recipe.id}: ${error.message}`, { cause: error });
    }
    fixtureHashes[fixture.id] = sha256(bytes);
  }
  const sourcePath = path.relative(repoRoot, filename).split(path.sep).join("/");
  return {
    ...recipe,
    recipeHash: computeRecipeHash(recipe, fixtureHashes),
    fixtureHashes,
    sourcePath
  };
}

function catalogSnapshot({ schemaVersion, domains, tags, variants, recipes }) {
  return {
    schemaVersion,
    domains,
    tags,
    variants,
    recipes: recipes.map((record) => {
      const recipe = { ...record };
      delete recipe.recipeHash;
      delete recipe.fixtureHashes;
      delete recipe.sourcePath;
      return { recipe, recipeHash: record.recipeHash };
    })
  };
}

/** Hash the public catalog snapshot. Absolute paths and filesystem discovery order are excluded. */
export function computeCatalogHash(catalog) {
  return hashCanonical(catalogSnapshot(catalog));
}

/**
 * Load a repository's catalog. The supplied root must contain catalog/domains.json,
 * catalog/tags.json, catalog/variants.json, and nested recipe.json files.
 */
export async function loadCatalog(repoRoot) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) throw new TypeError("repoRoot must be a path string");
  const root = path.resolve(repoRoot);
  const catalogDirectory = path.join(root, CATALOG_DIRECTORY);
  const [domainDocument, tagDocument, variantDocument, recipeFiles] = await Promise.all([
    readJson(path.join(catalogDirectory, "domains.json")),
    readJson(path.join(catalogDirectory, "tags.json")),
    readJson(path.join(catalogDirectory, "variants.json")),
    findRecipeFiles(path.join(catalogDirectory, "recipes"))
  ]);
  const recipes = await Promise.all(recipeFiles.map((filename) => loadRecipe(root, filename)));
  recipes.sort((left, right) => compareText(left.id, right.id));

  const duplicateRecipe = recipes.find((recipe, index) => index > 0 && recipe.id === recipes[index - 1].id);
  if (duplicateRecipe) throw new Error(`Duplicate recipe id: ${duplicateRecipe.id}`);
  const variantIds = new Set();
  for (const variant of variantDocument.variants ?? []) {
    if (variantIds.has(variant.id)) throw new Error(`Duplicate variant id: ${variant.id}`);
    variantIds.add(variant.id);
  }

  const schemaVersions = [domainDocument.schemaVersion, tagDocument.schemaVersion, variantDocument.schemaVersion];
  if (new Set(schemaVersions).size !== 1) throw new Error("Catalog documents have mismatched schemaVersion values");
  const catalog = {
    root,
    schemaVersion: schemaVersions[0],
    domains: domainDocument.domains ?? [],
    tags: tagDocument.tags ?? [],
    variants: variantDocument.variants ?? [],
    recipes
  };
  return { ...catalog, catalogHash: computeCatalogHash(catalog) };
}

function values(filter, singular, plural) {
  const selected = filter[plural] ?? filter[singular];
  if (selected === undefined) return null;
  return new Set(Array.isArray(selected) ? selected : [selected]);
}

/** Return recipe records in stable domain-order/id order. Tags use all-of matching by default. */
export function listRecipes(catalog, filter = {}) {
  const ids = values(filter, "id", "ids");
  const domains = values(filter, "domain", "domains");
  const statuses = values(filter, "status", "statuses");
  const origins = values(filter, "origin", "origins");
  const kinds = values(filter, "kind", "kinds");
  const tags = values(filter, "tag", "tags");
  const domainOrder = new Map(catalog.domains.map((domain) => [domain.id, domain.order]));
  return catalog.recipes
    .filter((recipe) => !ids || ids.has(recipe.id))
    .filter((recipe) => !domains || domains.has(recipe.domain))
    .filter((recipe) => !statuses || statuses.has(recipe.status))
    .filter((recipe) => !origins || origins.has(recipe.origin))
    .filter((recipe) => !kinds || kinds.has(recipe.kind))
    .filter((recipe) => !tags || (filter.matchAnyTag
      ? recipe.tags.some((tag) => tags.has(tag))
      : [...tags].every((tag) => recipe.tags.includes(tag))))
    .sort((left, right) => {
      const byDomain = (domainOrder.get(left.domain) ?? Number.MAX_SAFE_INTEGER)
        - (domainOrder.get(right.domain) ?? Number.MAX_SAFE_INTEGER);
      return byDomain || compareText(left.id, right.id);
    });
}

export function resolveVariant(catalog, variantId) {
  const variant = catalog.variants.find((candidate) => candidate.id === variantId);
  if (!variant) throw new Error(`Unknown variant id: ${variantId}`);
  return {
    ...variant,
    capabilities: [...variant.capabilities],
    ...(variant.executionProfile ? { executionProfile: { ...variant.executionProfile } } : {}),
    configHash: computeConfigHash(variant)
  };
}

function selectedRecipeIds(options) {
  const selection = options.recipeIds ?? options.flightIds ?? options.flight;
  if (selection === undefined) return null;
  if (typeof selection === "string") return [selection];
  if (!Array.isArray(selection) || selection.some((id) => typeof id !== "string")) {
    throw new TypeError("recipeIds/flight must be a recipe-id string or array of recipe-id strings");
  }
  return [...new Set(selection)];
}

/**
 * Plan recipe × variant execution without mutating the catalog. `flight` is a
 * deliberately lean ordered list of recipe IDs; callers do not need a flight schema.
 */
export function planSelection(catalog, options = {}) {
  const variant = resolveVariant(catalog, options.variantId);
  const recipeIds = selectedRecipeIds(options);
  let recipes;
  if (recipeIds) {
    const byId = new Map(catalog.recipes.map((recipe) => [recipe.id, recipe]));
    const unknown = recipeIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) throw new Error(`Unknown recipe id${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
    recipes = recipeIds.map((id) => byId.get(id));
  } else {
    recipes = listRecipes(catalog, options.filter ?? { status: "ready" });
  }

  const allowedStatuses = new Set(options.allowStatuses ?? ["ready"]);
  const available = new Set(variant.capabilities);
  const items = recipes.map((recipe) => {
    const requiredCapabilities = normalizeCapabilities(recipe.harness.capabilities);
    const missingCapabilities = requiredCapabilities.filter((capability) => !available.has(capability));
    const reasons = [];
    if (!allowedStatuses.has(recipe.status)) reasons.push(`recipe status is ${recipe.status}, not an allowed runnable status`);
    for (const capability of missingCapabilities) reasons.push(`variant lacks required capability: ${capability}`);
    if (recipe.harness.web === "enabled" && variant.executionProfile?.nativeWeb === "disabled") {
      reasons.push("variant execution profile disables native web");
    }
    return {
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      recipeHash: recipe.recipeHash,
      sourcePath: recipe.sourcePath,
      requiredCapabilities,
      missingCapabilities,
      supported: reasons.length === 0,
      reasons
    };
  });

  return {
    schemaVersion: 1,
    catalogHash: catalog.catalogHash,
    variant,
    selection: recipeIds ? { type: "flight", recipeIds } : { type: "filter", filter: options.filter ?? { status: "ready" } },
    items,
    supported: items.filter((item) => item.supported),
    unsupported: items.filter((item) => !item.supported)
  };
}
