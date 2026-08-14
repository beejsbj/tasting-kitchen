import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const errors = [];
const allowedKinds = new Set(["web", "image", "code", "session", "document", "audio"]);
const allowedOrigins = new Set(["textbook", "mothers", "hybrid"]);
const allowedStatuses = new Set(["draft", "ready", "hidden"]);
const allowedRoles = new Set(["prompt", "follow-up", "correction", "mode-transition"]);
const forbiddenKeys = new Set(["score", "scores", "rating", "rank", "winner"]);
const secretPatterns = [
  /\/(?:home|Users)\//,
  /file:\/\//i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:OPENAI|ANTHROPIC|GEMINI|NOUS|AWS)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)/,
  /\b(?:CJ|MC|MCL|AO|DA|E)\d{3}\b/
];

async function json(relative) {
  try {
    return JSON.parse(await readFile(path.join(root, relative), "utf8"));
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
    return null;
  }
}

async function walk(directory, basename) {
  const absolute = path.join(root, directory);
  try {
    const entries = await readdir(absolute, { withFileTypes: true });
    const matches = [];
    for (const entry of entries) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) matches.push(...await walk(relative, basename));
      else if (entry.name === basename) matches.push(relative);
    }
    return matches;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function required(value, keys, label) {
  for (const key of keys) if (!(key in value)) errors.push(`${label}: missing ${key}`);
}

function publicSafety(value, label, key = "") {
  if (forbiddenKeys.has(key.toLowerCase())) errors.push(`${label}: forbidden scoring key ${key}`);
  if (typeof value === "string") {
    for (const pattern of secretPatterns) if (pattern.test(value)) errors.push(`${label}: public-safety pattern ${pattern} matched`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => publicSafety(item, `${label}[${index}]`));
  if (value && typeof value === "object") for (const [childKey, child] of Object.entries(value)) publicSafety(child, `${label}.${childKey}`, childKey);
}

function safeRelative(value, label) {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    errors.push(`${label}: must be a contained relative path`);
  }
}

const domainsDoc = await json("catalog/domains.json");
const tagsDoc = await json("catalog/tags.json");
const variantsDoc = await json("catalog/variants.json");
const domains = new Set(domainsDoc?.domains?.map((item) => item.id) ?? []);
const tags = new Set(tagsDoc?.tags ?? []);
const variants = new Map((variantsDoc?.variants ?? []).map((item) => [item.id, item]));

if (domains.size !== 9) errors.push(`catalog/domains.json: expected 9 unique domains, found ${domains.size}`);
if (tags.size !== (tagsDoc?.tags?.length ?? -1)) errors.push("catalog/tags.json: duplicate tag");
if (variants.size !== 5) errors.push(`catalog/variants.json: expected 5 seed variants, found ${variants.size}`);

for (const [id, variant] of variants) {
  required(variant, ["id", "label", "provider", "model", "harness", "reasoningEffort", "serviceTier", "personality"], `variant ${id}`);
  if (variant.model === "gpt-5.6-luna" && !["low", "high", "xhigh"].includes(variant.reasoningEffort)) errors.push(`variant ${id}: unsupported Luna seed effort`);
  if (variant.model === "gpt-5.6-luna" && variant.serviceTier !== "fast") errors.push(`variant ${id}: Luna seed must be explicitly fast`);
}

const recipeFiles = await walk("catalog/recipes", "recipe.json");
const recipeIds = new Set();
for (const relative of recipeFiles) {
  const recipe = await json(relative);
  if (!recipe) continue;
  const label = relative;
  required(recipe, ["schemaVersion", "id", "version", "status", "title", "summary", "domain", "origin", "originNote", "tags", "kind", "harness", "setup", "turns", "output", "validation"], label);
  if (recipeIds.has(recipe.id)) errors.push(`${label}: duplicate recipe id ${recipe.id}`);
  recipeIds.add(recipe.id);
  if (recipe.schemaVersion !== 1) errors.push(`${label}: schemaVersion must be 1`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(recipe.id ?? "")) errors.push(`${label}: invalid id`);
  if (!/^\d+\.\d+\.\d+$/.test(recipe.version ?? "")) errors.push(`${label}: invalid semver`);
  if (!allowedStatuses.has(recipe.status)) errors.push(`${label}: invalid status`);
  if (!domains.has(recipe.domain)) errors.push(`${label}: unknown domain ${recipe.domain}`);
  if (!allowedOrigins.has(recipe.origin)) errors.push(`${label}: invalid origin`);
  if (!allowedKinds.has(recipe.kind) || recipe.output?.kind !== recipe.kind) errors.push(`${label}: artifact kind mismatch`);
  if (!Array.isArray(recipe.tags) || recipe.tags.length < 1 || recipe.tags.length > 6) errors.push(`${label}: tags must contain 1-6 values`);
  for (const tag of recipe.tags ?? []) if (!tags.has(tag)) errors.push(`${label}: unknown tag ${tag}`);
  if (!Array.isArray(recipe.turns) || recipe.turns.length < 1) errors.push(`${label}: at least one turn is required`);
  if (recipe.turns?.[0]?.role !== "prompt") errors.push(`${label}: first turn must be prompt`);
  const turnIds = new Set();
  for (const turn of recipe.turns ?? []) {
    if (!allowedRoles.has(turn.role)) errors.push(`${label}: invalid turn role ${turn.role}`);
    if (turnIds.has(turn.id)) errors.push(`${label}: duplicate turn id ${turn.id}`);
    turnIds.add(turn.id);
  }
  safeRelative(recipe.output?.entry, `${label}.output.entry`);
  for (const fixture of recipe.setup?.fixtures ?? []) {
    safeRelative(fixture.path, `${label}.fixture.${fixture.id}.path`);
    safeRelative(fixture.mountAs, `${label}.fixture.${fixture.id}.mountAs`);
    const absoluteFixture = path.join(root, path.dirname(relative), fixture.path);
    try {
      if (!(await stat(absoluteFixture)).isFile()) errors.push(`${label}: fixture ${fixture.path} is not a file`);
    } catch {
      errors.push(`${label}: fixture ${fixture.path} does not exist`);
    }
  }
  if (recipe.status === "ready" && (recipe.validation?.checks?.length ?? 0) < 1) errors.push(`${label}: ready recipe requires a validation check`);
  publicSafety(recipe, label);
}

const dishFiles = await walk("dishes", "dish.json");
const dishIds = new Set();
for (const relative of dishFiles) {
  const dish = await json(relative);
  if (!dish) continue;
  required(dish, ["schemaVersion", "id", "recipe", "executedAt", "identity", "status", "artifact", "validation", "dishHash"], relative);
  if (dishIds.has(dish.id)) errors.push(`${relative}: duplicate dish id ${dish.id}`);
  dishIds.add(dish.id);
  if (!recipeIds.has(dish.recipe?.id)) errors.push(`${relative}: unknown recipe ${dish.recipe?.id}`);
  if (!variants.has(dish.identity?.variantId)) errors.push(`${relative}: unknown variant ${dish.identity?.variantId}`);
  if (dish.status !== "accepted" || dish.validation?.passed !== true) errors.push(`${relative}: only accepted passing dishes may be public`);
  if (!allowedKinds.has(dish.artifact?.kind)) errors.push(`${relative}: invalid artifact kind`);
  safeRelative(dish.artifact?.entry, `${relative}.artifact.entry`);
  for (const file of dish.artifact?.files ?? []) safeRelative(file.path, `${relative}.artifact.files`);
  publicSafety(dish, relative);
}

if (errors.length) {
  console.error(`Catalog validation failed with ${errors.length} error${errors.length === 1 ? "" : "s"}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Catalog valid: ${domains.size} domains, ${tags.size} tags, ${variants.size} variants, ${recipeFiles.length} recipes, ${dishFiles.length} dishes.`);
