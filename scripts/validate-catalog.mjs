import { createHash } from "node:crypto";
import { access, lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { computeConfigHash, computeRecipeHash, hashCanonical, sha256 } from "../lib/taste/catalog.mjs";
import { adapterSupport } from "../lib/taste/harness-adapters.mjs";
import { describeTree } from "../lib/taste/files.mjs";
import { serviceTiersMatch } from "../lib/taste/identity.mjs";
import { loadAxisSets, loadObservations } from "../lib/taste/observations.mjs";
import { INPUTS_MANIFEST, RECEIPT_MANIFEST, validateSkillReceipt, verifyInputs } from "../lib/taste/receipts.mjs";

const args = process.argv.slice(2);
if (args.some((argument) => argument !== "--public-checkout") || args.length > 1) {
  console.error("Usage: node scripts/validate-catalog.mjs [--public-checkout]");
  process.exit(1);
}
// Public checkout validation never reads private provenance, even when present.
// The default remains strict: every Recipe requires valid private provenance.
const publicCheckout = args.includes("--public-checkout");

const root = path.resolve(process.env.TASTE_CATALOG_ROOT ?? path.resolve(import.meta.dirname, ".."));
const errors = [];

const IDS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DISH_IDS = /^dish_[a-zA-Z0-9_-]+$/;
const REVIEW_IDS = /^review_[a-zA-Z0-9_-]+$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const BARE_SHA256 = /^[a-f0-9]{64}$/;
const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

const allowedKinds = new Set(["web", "image", "code", "session", "document", "audio"]);
const allowedOrigins = new Set(["textbook", "mothers", "hybrid"]);
const allowedStatuses = new Set(["draft", "ready", "hidden"]);
const allowedRoles = new Set(["prompt", "follow-up", "correction", "mode-transition"]);
const allowedWorkspaces = new Set(["read", "write"]);
const allowedWebModes = new Set(["disabled", "enabled", "closed-sources-only"]);
const allowedCapabilities = new Set(["files", "shell", "tools", "delegation", "image-generation"]);
const allowedValidationModes = new Set(["completeness", "files", "interaction", "tests", "trace", "manual"]);
const allowedCheckTypes = new Set(["file-exists", "command", "json-schema", "trace-assertion", "manual"]);
const executableCheckTypes = new Set(["file-exists", "command", "json-schema"]);
const nonGatingCheckTypes = new Set(["trace-assertion", "manual"]);
const allowedReviewVerdicts = new Set(["pass", "issue", "inconclusive"]);
const allowedReviewerKinds = new Set(["human", "agent"]);

const forbiddenKeys = new Set(["score", "scores", "rating", "ratings", "rank", "ranking", "winner", "leaderboard"]);
const publicLeakPatterns = [
  { name: "private Unix home path", pattern: /\/(?:home|Users)\// },
  { name: "private Windows home path", pattern: /[a-z]:\\Users\\/i },
  { name: "file URL", pattern: /file:\/\//i },
  { name: "home path form", pattern: /(?:^|[\s("'`])(?:~\/|\$HOME(?:\/|\b)|\$\{HOME\}(?:\/|\b)|%USERPROFILE%(?:[\\/]|\b))/im },
  { name: "private directory reference", pattern: /(?:^|[\\/])private[\\/]/im },
  { name: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "provider credential variable", pattern: /(?:OPENAI|ANTHROPIC|GEMINI|NOUS|AWS)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)/ },
  { name: "API-key-like value", pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/ },
  { name: "private evidence ID", pattern: /\b(?:CJ|MC|MCL|AO|DA|E)\d{3}\b/ },
  { name: "numerical ranking language", pattern: /\b(?:leaderboards?|ratings?|rankings?|scoring|scores?)\b/i }
];

const RECIPE_KEYS = new Set(["schemaVersion", "id", "version", "status", "visibility", "title", "summary", "cuisines", "origin", "originNote", "tags", "kind", "harness", "setup", "turns", "output", "validation", "presentation", "skills", "variation", "supersedes"]);
const SKILLS_CONTRACT_KEYS = new Set(["mountAs", "optional", "layers"]);
const SKILL_KEYS = new Set(["id", "label", "summary", "entry", "source", "delivery"]);
const allowedSkillDeliveries = new Set(["workspace", "prompt"]);
const SKILL_SOURCE_KEYS = new Set(["repository", "commit", "path", "license"]);
const allowedVisibilities = new Set(["public", "private"]);
const HARNESS_KEYS = new Set(["workspace", "web", "capabilities"]);
const SETUP_KEYS = new Set(["instructions", "fixtures"]);
const FIXTURE_KEYS = new Set(["id", "path", "mountAs", "public", "editable", "mediaType"]);
const TURN_KEYS = new Set(["id", "role", "content"]);
const OUTPUT_KEYS = new Set(["kind", "entry", "include", "limits"]);
const LIMIT_KEYS = new Set(["maxFiles", "maxBytes"]);
const VALIDATION_KEYS = new Set(["mode", "checks"]);
const PRESENTATION_KEYS = new Set(["profile", "semanticRuntime"]);
const SEMANTIC_RUNTIME_KEYS = new Set(["id", "version"]);
const CHECK_KEYS = new Set(["id", "type", "required", "description", "target", "schema", "argv"]);

const DISH_KEYS = new Set(["schemaVersion", "id", "recipe", "skill", "visibility", "executedAt", "finalizedAt", "identity", "status", "artifact", "validation", "publicTrace", "dishHash"]);
const DISH_RECIPE_KEYS = new Set(["id", "version", "hash"]);
const IDENTITY_KEYS = new Set(["variantId", "provider", "requestedModel", "observedModel", "harness", "harnessVersion", "reasoningEffort", "serviceTier", "requestedServiceTier", "observedServiceTier", "configHash", "catalogHash"]);
const ARTIFACT_KEYS = new Set(["kind", "entry", "preview", "treeHash", "files"]);
const ARTIFACT_FILE_KEYS = new Set(["path", "sha256", "bytes"]);
const DISH_VALIDATION_KEYS = new Set(["passed", "report"]);
const REVIEW_KEYS = new Set(["schemaVersion", "id", "dishId", "dishHash", "reviewer", "reviewerKind", "reviewedAt", "probes"]);
const REVIEW_PROBE_KEYS = new Set(["id", "device", "viewport", "verdict", "finding", "details"]);
const VIEWPORT_KEYS = new Set(["width", "height", "deviceScaleFactor"]);
const PROBE_DETAILS_KEYS = new Set(["method", "path", "scrollWidth", "clientWidth"]);
const EXECUTION_PROFILE_KEYS = new Set(["id", "label", "runtime", "sandbox", "approvalPolicy", "nativeWeb", "networkPolicy", "filesystemBoundary"]);

function fail(label, message) {
  errors.push(`${label}: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object(value, label) {
  if (!isObject(value)) {
    fail(label, "must be an object");
    return false;
  }
  return true;
}

function onlyKeys(value, allowed, label) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(label, `unknown key ${key}`);
}

function required(value, keys, label) {
  if (!isObject(value)) return;
  for (const key of keys) if (!(key in value)) fail(label, `missing ${key}`);
}

function string(value, label, { min = 1, max = Infinity, pattern } = {}) {
  if (typeof value !== "string") return fail(label, "must be a string");
  if (value.length < min) fail(label, `must contain at least ${min} character${min === 1 ? "" : "s"}`);
  if (value.length > max) fail(label, `must contain at most ${max} characters`);
  if (pattern && !pattern.test(value)) fail(label, "has an invalid format");
}

function boolean(value, label) {
  if (typeof value !== "boolean") fail(label, "must be a boolean");
}

function integer(value, label, min, max) {
  if (!Number.isInteger(value)) return fail(label, "must be an integer");
  if (value < min || value > max) fail(label, `must be between ${min} and ${max}`);
}

function number(value, label, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fail(label, "must be a finite number");
  if (value < min || value > max) fail(label, `must be between ${min} and ${max}`);
}

function array(value, label, { min = 0, max = Infinity } = {}) {
  if (!Array.isArray(value)) {
    fail(label, "must be an array");
    return false;
  }
  if (value.length < min) fail(label, `must contain at least ${min} item${min === 1 ? "" : "s"}`);
  if (value.length > max) fail(label, `must contain at most ${max} items`);
  return true;
}

function unique(values, label, key = (value) => value) {
  const seen = new Set();
  for (const value of values ?? []) {
    const identity = key(value);
    if (seen.has(identity)) fail(label, `duplicate value ${identity}`);
    seen.add(identity);
  }
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) fail(label, `invalid value ${JSON.stringify(value)}`);
}

function safeRelative(value, label, { glob = false } = {}) {
  if (typeof value !== "string" || value.length === 0) {
    fail(label, "must be a non-empty contained relative path");
    return false;
  }
  const unsafe = value.includes("\0") || value.includes("\\") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
  const segments = value.split("/");
  if (unsafe || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(label, `must be a contained POSIX-relative ${glob ? "glob" : "path"}`);
    return false;
  }
  if (!glob && /[*?[\]{}]/.test(value)) {
    fail(label, "must be a literal path, not a glob");
    return false;
  }
  return true;
}

function resolveContained(base, relative, label) {
  if (!safeRelative(relative, label)) return null;
  const resolved = path.resolve(base, relative);
  const prefix = `${path.resolve(base)}${path.sep}`;
  if (!resolved.startsWith(prefix)) {
    fail(label, "escapes its containing directory");
    return null;
  }
  return resolved;
}

function globCovers(glob, target) {
  if (glob === target) return true;
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*").replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`).test(target);
}

function publicSafety(value, label, key = "") {
  if (forbiddenKeys.has(key.toLowerCase())) fail(label, `forbidden scoring key ${key}`);
  if (typeof value === "string") {
    scanText(value, label);
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => publicSafety(item, `${label}[${index}]`));
  if (isObject(value)) for (const [childKey, child] of Object.entries(value)) publicSafety(child, `${label}.${childKey}`, childKey);
}

function scanText(text, label) {
  for (const { name, pattern } of publicLeakPatterns) if (pattern.test(text)) fail(label, `public-safety scan matched ${name}`);
}

async function json(relative) {
  try {
    return JSON.parse(await readFile(path.join(root, relative), "utf8"));
  } catch (error) {
    fail(relative, error.message);
    return null;
  }
}

async function walk(directory, { basename, allFiles = false } = {}) {
  const absolute = path.join(root, directory);
  try {
    const entries = await readdir(absolute, { withFileTypes: true });
    const matches = [];
    for (const entry of entries) {
      const relative = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        fail(relative, "symbolic links are forbidden in public catalog trees");
      } else if (entry.isDirectory()) {
        matches.push(...await walk(relative, { basename, allFiles }));
      } else if (entry.isFile() && (allFiles || entry.name === basename)) {
        matches.push(relative);
      }
    }
    return matches;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function regularFile(absolute, label) {
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) return fail(label, "symbolic links are forbidden"), false;
    if (!info.isFile()) return fail(label, "must reference a regular file"), false;
    return true;
  } catch (error) {
    fail(label, error.code === "ENOENT" ? "referenced file does not exist" : error.message);
    return false;
  }
}

function meaningful(value) {
  return typeof value === "string" ? value.trim().length > 0 : Array.isArray(value) ? value.length > 0 : isObject(value) ? Object.keys(value).length > 0 : false;
}

function validateCuisines(doc) {
  const label = "catalog/cuisines.json";
  if (!object(doc, label)) return new Set();
  onlyKeys(doc, new Set(["schemaVersion", "cuisines"]), label);
  required(doc, ["schemaVersion", "cuisines"], label);
  if (doc.schemaVersion !== 1) fail(label, "schemaVersion must be 1");
  if (!array(doc.cuisines, `${label}.cuisines`, { min: 1 })) return new Set();
  if (doc.cuisines.length !== 9) fail(label, `expected 9 cuisines, found ${doc.cuisines.length}`);
  const ids = [];
  const orders = [];
  for (const [index, cuisine] of doc.cuisines.entries()) {
    const item = `${label}.cuisines[${index}]`;
    if (!object(cuisine, item)) continue;
    onlyKeys(cuisine, new Set(["id", "label", "description", "order"]), item);
    required(cuisine, ["id", "label", "description", "order"], item);
    string(cuisine.id, `${item}.id`, { pattern: IDS });
    string(cuisine.label, `${item}.label`, { min: 3, max: 100 });
    string(cuisine.description, `${item}.description`, { min: 12, max: 300 });
    integer(cuisine.order, `${item}.order`, 0, 10000);
    ids.push(cuisine.id);
    orders.push(cuisine.order);
  }
  unique(ids, `${label}.cuisines ids`);
  unique(orders, `${label}.cuisines order`);
  for (let index = 1; index < orders.length; index += 1) if (orders[index] <= orders[index - 1]) fail(label, "cuisines must be ordered by ascending order");
  return new Set(ids);
}

function validateTags(doc) {
  const label = "catalog/tags.json";
  if (!object(doc, label)) return new Set();
  onlyKeys(doc, new Set(["schemaVersion", "tags"]), label);
  required(doc, ["schemaVersion", "tags"], label);
  if (doc.schemaVersion !== 1) fail(label, "schemaVersion must be 1");
  if (!array(doc.tags, `${label}.tags`, { min: 1 })) return new Set();
  for (const [index, tag] of doc.tags.entries()) string(tag, `${label}.tags[${index}]`, { pattern: IDS });
  unique(doc.tags, `${label}.tags`);
  const sorted = [...doc.tags].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(sorted) !== JSON.stringify(doc.tags)) fail(label, "tags must remain alphabetically sorted");
  return new Set(doc.tags);
}

function validateConfigurations(doc) {
  const label = "catalog/configurations.json";
  if (!object(doc, label)) return new Map();
  onlyKeys(doc, new Set(["schemaVersion", "configurations"]), label);
  required(doc, ["schemaVersion", "configurations"], label);
  if (doc.schemaVersion !== 1) fail(label, "schemaVersion must be 1");
  if (!array(doc.configurations, `${label}.configurations`, { min: 1 })) return new Map();
  if (doc.configurations.length < 1) fail(label, "expected at least one configuration");
  const map = new Map();
  const tuples = [];
  const allowedKeys = new Set(["id", "label", "provider", "model", "harness", "reasoningEffort", "serviceTier", "personality", "capabilities", "executionProfile"]);
  for (const [index, variant] of doc.configurations.entries()) {
    const item = `${label}.configurations[${index}]`;
    if (!object(variant, item)) continue;
    onlyKeys(variant, allowedKeys, item);
    required(variant, [...allowedKeys], item);
    string(variant.id, `${item}.id`, { pattern: IDS });
    for (const key of ["label", "provider", "model", "harness", "reasoningEffort", "serviceTier", "personality"]) string(variant[key], `${item}.${key}`);
    if (map.has(variant.id)) fail(item, `duplicate variant id ${variant.id}`);
    map.set(variant.id, variant);
    if (array(variant.capabilities, `${item}.capabilities`)) {
      unique(variant.capabilities, `${item}.capabilities`);
      for (const capability of variant.capabilities) enumValue(capability, allowedCapabilities, `${item}.capabilities`);
    }
    if (object(variant.executionProfile, `${item}.executionProfile`)) {
      const profile = variant.executionProfile;
      onlyKeys(profile, EXECUTION_PROFILE_KEYS, `${item}.executionProfile`);
      required(profile, [...EXECUTION_PROFILE_KEYS], `${item}.executionProfile`);
      for (const key of EXECUTION_PROFILE_KEYS) string(profile[key], `${item}.executionProfile.${key}`);
    }
    const adapterReason = adapterSupport(variant);
    if (adapterReason) fail(item, adapterReason);
    if (variant.model === "gpt-5.6-luna" && !new Set(["low", "high", "xhigh"]).has(variant.reasoningEffort)) fail(item, "unsupported Luna seed effort");
    tuples.push([variant.provider, variant.model, variant.harness, variant.reasoningEffort, variant.serviceTier, variant.personality, JSON.stringify(variant.executionProfile), ...(variant.capabilities ?? [])].join("\0"));
  }
  unique(tuples, `${label}.configurations configuration`);
  return map;
}

async function validateSkills(doc) {
  const label = "catalog/skills.json";
  const ids = new Map();
  if (doc === null) return ids;
  if (!object(doc, label)) return ids;
  onlyKeys(doc, new Set(["schemaVersion", "skills"]), label);
  required(doc, ["schemaVersion", "skills"], label);
  if (doc.schemaVersion !== 1) fail(label, "schemaVersion must be 1");
  if (!array(doc.skills, `${label}.skills`)) return ids;
  for (const [index, skill] of doc.skills.entries()) {
    const item = `${label}.skills[${index}]`;
    if (!object(skill, item)) continue;
    onlyKeys(skill, SKILL_KEYS, item);
    required(skill, ["id", "label", "summary", "entry", "source"], item);
    if (skill.delivery !== undefined) enumValue(skill.delivery, allowedSkillDeliveries, `${item}.delivery`);
    string(skill.id, `${item}.id`, { pattern: IDS });
    if (skill.id === "none") fail(item, "none is reserved for the absent layer");
    string(skill.label, `${item}.label`, { min: 3, max: 100 });
    string(skill.summary, `${item}.summary`, { min: 12, max: 300 });
    safeRelative(skill.entry, `${item}.entry`);
    if (object(skill.source, `${item}.source`)) {
      onlyKeys(skill.source, SKILL_SOURCE_KEYS, `${item}.source`);
      required(skill.source, [...SKILL_SOURCE_KEYS], `${item}.source`);
      string(skill.source.repository, `${item}.source.repository`, { pattern: /^https:\/\/[^\s]+$/ });
      string(skill.source.commit, `${item}.source.commit`, { pattern: /^[a-f0-9]{40}$/ });
      string(skill.source.path, `${item}.source.path`);
      string(skill.source.license, `${item}.source.license`);
    }
    if (ids.has(skill.id)) fail(item, `duplicate skill id ${skill.id}`);
    const filesDirectory = `catalog/skills/${skill.id}/files`;
    const mounted = await walk(filesDirectory, { allFiles: true });
    if (!mounted.length) fail(item, `${filesDirectory} must contain the mounted skill source`);
    else if (typeof skill.entry === "string" && !mounted.includes(path.join(filesDirectory, skill.entry))) fail(item, `entry ${skill.entry} is not among the mounted files`);
    ids.set(skill.id, skill);
  }
  publicSafety(doc, label);
  return ids;
}

async function validateRecipe(relative, cuisines, tags, skills) {
  const recipe = await json(relative);
  if (!recipe || !object(recipe, relative)) return null;
  onlyKeys(recipe, RECIPE_KEYS, relative);
  required(recipe, ["schemaVersion", "id", "version", "status", "title", "summary", "cuisines", "origin", "originNote", "tags", "kind", "harness", "setup", "turns", "output", "validation"], relative);
  if (recipe.schemaVersion !== 1) fail(relative, "schemaVersion must be 1");
  string(recipe.id, `${relative}.id`, { pattern: IDS });
  string(recipe.version, `${relative}.version`, { pattern: SEMVER });
  enumValue(recipe.status, allowedStatuses, `${relative}.status`);
  if (recipe.visibility !== undefined) enumValue(recipe.visibility, allowedVisibilities, `${relative}.visibility`);
  const privateRecipe = recipe.visibility === "private";
  string(recipe.title, `${relative}.title`, { min: 4, max: 100 });
  string(recipe.summary, `${relative}.summary`, { min: 12, max: 300 });
  if (array(recipe.cuisines, `${relative}.cuisines`, { min: 1 })) {
    unique(recipe.cuisines, `${relative}.cuisines`);
    for (const cuisine of recipe.cuisines) {
      string(cuisine, `${relative}.cuisines`, { pattern: IDS });
      if (!cuisines.has(cuisine)) fail(relative, `unknown cuisine ${cuisine}`);
    }
  }
  enumValue(recipe.origin, allowedOrigins, `${relative}.origin`);
  string(recipe.originNote, `${relative}.originNote`, { min: 8, max: 300 });
  enumValue(recipe.kind, allowedKinds, `${relative}.kind`);
  if ("variation" in recipe) string(recipe.variation, `${relative}.variation`, { max: 500 });
  if ("supersedes" in recipe) string(recipe.supersedes, `${relative}.supersedes`, { pattern: IDS });
  if (recipe.presentation !== undefined && object(recipe.presentation, `${relative}.presentation`)) {
    onlyKeys(recipe.presentation, PRESENTATION_KEYS, `${relative}.presentation`);
    required(recipe.presentation, ["profile", "semanticRuntime"], `${relative}.presentation`);
    string(recipe.presentation.profile, `${relative}.presentation.profile`, { pattern: IDS });
    if (recipe.presentation.semanticRuntime !== null && object(recipe.presentation.semanticRuntime, `${relative}.presentation.semanticRuntime`)) {
      onlyKeys(recipe.presentation.semanticRuntime, SEMANTIC_RUNTIME_KEYS, `${relative}.presentation.semanticRuntime`);
      required(recipe.presentation.semanticRuntime, ["id", "version"], `${relative}.presentation.semanticRuntime`);
      string(recipe.presentation.semanticRuntime.id, `${relative}.presentation.semanticRuntime.id`, { pattern: IDS });
      string(recipe.presentation.semanticRuntime.version, `${relative}.presentation.semanticRuntime.version`);
    } else if (recipe.presentation.semanticRuntime !== null) fail(`${relative}.presentation.semanticRuntime`, "must be null or an object");
  }

  const expectedId = path.basename(path.dirname(relative));
  if (recipe.id !== expectedId) fail(relative, `id must match recipe directory ${expectedId}`);

  if (array(recipe.tags, `${relative}.tags`, { min: 1, max: 6 })) {
    unique(recipe.tags, `${relative}.tags`);
    for (const tag of recipe.tags) {
      string(tag, `${relative}.tags`, { pattern: IDS });
      if (!tags.has(tag)) fail(relative, `unknown tag ${tag}`);
    }
  }

  if (object(recipe.harness, `${relative}.harness`)) {
    onlyKeys(recipe.harness, HARNESS_KEYS, `${relative}.harness`);
    required(recipe.harness, ["workspace", "web", "capabilities"], `${relative}.harness`);
    enumValue(recipe.harness.workspace, allowedWorkspaces, `${relative}.harness.workspace`);
    enumValue(recipe.harness.web, allowedWebModes, `${relative}.harness.web`);
    if (array(recipe.harness.capabilities, `${relative}.harness.capabilities`)) {
      unique(recipe.harness.capabilities, `${relative}.harness.capabilities`);
      for (const capability of recipe.harness.capabilities) enumValue(capability, allowedCapabilities, `${relative}.harness.capabilities`);
    }
  }

  const recipeDirectory = path.dirname(path.join(root, relative));
  const mountedFixtures = new Map();
  if (object(recipe.setup, `${relative}.setup`)) {
    onlyKeys(recipe.setup, SETUP_KEYS, `${relative}.setup`);
    required(recipe.setup, ["instructions", "fixtures"], `${relative}.setup`);
    string(recipe.setup.instructions, `${relative}.setup.instructions`);
    if (array(recipe.setup.fixtures, `${relative}.setup.fixtures`)) {
      const fixtureIds = [];
      const mountPaths = [];
      for (const [index, fixture] of recipe.setup.fixtures.entries()) {
        const item = `${relative}.setup.fixtures[${index}]`;
        if (!object(fixture, item)) continue;
        onlyKeys(fixture, FIXTURE_KEYS, item);
        required(fixture, ["id", "path", "mountAs", "public", "mediaType"], item);
        string(fixture.id, `${item}.id`, { pattern: IDS });
        safeRelative(fixture.path, `${item}.path`);
        safeRelative(fixture.mountAs, `${item}.mountAs`);
        boolean(fixture.public, `${item}.public`);
        if (fixture.public === false && !privateRecipe) fail(item, "private fixtures belong only to recipes with visibility private");
        if (fixture.editable !== undefined) boolean(fixture.editable, `${item}.editable`);
        string(fixture.mediaType, `${item}.mediaType`, { pattern: MEDIA_TYPE });
        fixtureIds.push(fixture.id);
        mountPaths.push(fixture.mountAs);
        if (fixture.public === false) {
          // Private bytes live under the ignored private tree and may be absent on this machine.
          const privateSource = resolveContained(path.join(root, "private", "fixtures", recipe.id), fixture.path, `${item}.path`);
          if (privateSource) mountedFixtures.set(fixture.mountAs, privateSource);
          continue;
        }
        const source = resolveContained(recipeDirectory, fixture.path, `${item}.path`);
        if (source && await regularFile(source, `${item}.path`)) mountedFixtures.set(fixture.mountAs, source);
      }
      unique(fixtureIds, `${relative}.setup fixture ids`);
      unique(mountPaths, `${relative}.setup mount paths`);
    }
  }

  if (recipe.skills !== undefined && object(recipe.skills, `${relative}.skills`)) {
    onlyKeys(recipe.skills, SKILLS_CONTRACT_KEYS, `${relative}.skills`);
    required(recipe.skills, ["optional", "layers"], `${relative}.skills`);
    const skillMount = recipe.skills.mountAs ?? "skill";
    const hasWorkspaceLayer = Array.isArray(recipe.skills.layers) && recipe.skills.layers.some((id) => (skills.get(id)?.delivery ?? "workspace") === "workspace");
    if (safeRelative(skillMount, `${relative}.skills.mountAs`) && hasWorkspaceLayer) {
      for (const mountPath of mountedFixtures.keys()) {
        if (mountPath === skillMount || mountPath.startsWith(`${skillMount}/`) || skillMount.startsWith(`${mountPath}/`)) fail(`${relative}.skills.mountAs`, `collides with fixture mount ${mountPath}`);
      }
    }
    boolean(recipe.skills.optional, `${relative}.skills.optional`);
    if (array(recipe.skills.layers, `${relative}.skills.layers`, { min: 1 })) {
      unique(recipe.skills.layers, `${relative}.skills.layers`);
      for (const layer of recipe.skills.layers) {
        string(layer, `${relative}.skills.layers`, { pattern: IDS });
        if (!skills.has(layer)) fail(`${relative}.skills.layers`, `unknown skill ${layer}`);
      }
    }
  }

  if (array(recipe.turns, `${relative}.turns`, { min: 1 })) {
    const turnIds = [];
    for (const [index, turn] of recipe.turns.entries()) {
      const item = `${relative}.turns[${index}]`;
      if (!object(turn, item)) continue;
      onlyKeys(turn, TURN_KEYS, item);
      required(turn, ["id", "role", "content"], item);
      string(turn.id, `${item}.id`, { pattern: IDS });
      enumValue(turn.role, allowedRoles, `${item}.role`);
      string(turn.content, `${item}.content`);
      turnIds.push(turn.id);
    }
    unique(turnIds, `${relative}.turn ids`);
    if (recipe.turns[0]?.role !== "prompt") fail(relative, "first turn must be prompt");
  }

  const includes = [];
  if (object(recipe.output, `${relative}.output`)) {
    onlyKeys(recipe.output, OUTPUT_KEYS, `${relative}.output`);
    required(recipe.output, ["kind", "entry", "include", "limits"], `${relative}.output`);
    enumValue(recipe.output.kind, allowedKinds, `${relative}.output.kind`);
    if (recipe.output.kind !== recipe.kind) fail(relative, "top-level and output artifact kinds must match");
    safeRelative(recipe.output.entry, `${relative}.output.entry`);
    if (array(recipe.output.include, `${relative}.output.include`, { min: 1 })) {
      unique(recipe.output.include, `${relative}.output.include`);
      for (const [index, include] of recipe.output.include.entries()) {
        safeRelative(include, `${relative}.output.include[${index}]`, { glob: true });
        includes.push(include);
      }
      if (typeof recipe.output.entry === "string" && !includes.some((include) => globCovers(include, recipe.output.entry))) {
        fail(relative, "output.entry must be covered by output.include");
      }
    }
    if (object(recipe.output.limits, `${relative}.output.limits`)) {
      onlyKeys(recipe.output.limits, LIMIT_KEYS, `${relative}.output.limits`);
      required(recipe.output.limits, ["maxFiles", "maxBytes"], `${relative}.output.limits`);
      integer(recipe.output.limits.maxFiles, `${relative}.output.limits.maxFiles`, 1, 2000);
      integer(recipe.output.limits.maxBytes, `${relative}.output.limits.maxBytes`, 1024, 104857600);
    }
  }

  if (object(recipe.validation, `${relative}.validation`)) {
    onlyKeys(recipe.validation, VALIDATION_KEYS, `${relative}.validation`);
    required(recipe.validation, ["mode", "checks"], `${relative}.validation`);
    enumValue(recipe.validation.mode, allowedValidationModes, `${relative}.validation.mode`);
    if (array(recipe.validation.checks, `${relative}.validation.checks`, { min: 1 })) {
      const checkIds = [];
      let executableGateCount = 0;
      for (const [index, check] of recipe.validation.checks.entries()) {
        const item = `${relative}.validation.checks[${index}]`;
        if (!object(check, item)) continue;
        onlyKeys(check, CHECK_KEYS, item);
        required(check, ["id", "type", "required", "description"], item);
        string(check.id, `${item}.id`, { pattern: IDS });
        enumValue(check.type, allowedCheckTypes, `${item}.type`);
        boolean(check.required, `${item}.required`);
        string(check.description, `${item}.description`, { min: 4 });
        checkIds.push(check.id);

        if (check.required === true && nonGatingCheckTypes.has(check.type)) {
          fail(item, `${check.type} is prose-only and cannot gate a recipe`);
        }
        if (check.required === true && executableCheckTypes.has(check.type)) executableGateCount += 1;

        if (check.type === "file-exists") {
          required(check, ["target"], item);
          if ("argv" in check || "schema" in check) fail(item, "file-exists accepts target only");
          if (safeRelative(check.target, `${item}.target`) && !includes.some((include) => globCovers(include, check.target))) fail(item, "file target must be covered by output.include");
        } else if (check.type === "command") {
          required(check, ["argv"], item);
          if ("target" in check || "schema" in check) fail(item, "command accepts argv only");
          if (array(check.argv, `${item}.argv`, { min: 1 })) {
            for (const [argumentIndex, argument] of check.argv.entries()) string(argument, `${item}.argv[${argumentIndex}]`);
            if (!new Set(["node", "npm", "pnpm"]).has(check.argv[0])) fail(item, "validator command must use the dependency-free node/npm/pnpm execution boundary");
            if (check.argv[0] === "node" && check.argv[1] && !check.argv[1].startsWith("-")) {
              if (safeRelative(check.argv[1], `${item}.argv[1]`) && !mountedFixtures.has(check.argv[1]) && !includes.some((include) => globCovers(include, check.argv[1]))) {
                fail(item, `validator script ${check.argv[1]} is neither a mounted fixture nor declared output`);
              }
            }
          }
        } else if (check.type === "json-schema") {
          required(check, ["target", "schema"], item);
          if ("argv" in check) fail(item, "json-schema accepts target and schema only");
          if (safeRelative(check.target, `${item}.target`) && !includes.some((include) => globCovers(include, check.target))) fail(item, "JSON target must be covered by output.include");
          if (safeRelative(check.schema, `${item}.schema`) && !mountedFixtures.has(check.schema)) fail(item, "JSON schema must be a declared mounted fixture");
        } else {
          if ("target" in check || "schema" in check || "argv" in check) fail(item, `${check.type} accepts no execution fields`);
        }
      }
      unique(checkIds, `${relative}.validation check ids`);
      if (recipe.status === "ready" && executableGateCount === 0) fail(relative, "ready recipe requires at least one required executable check");
    }
  }

  publicSafety(recipe, relative);
  // Hash the current contract from the same fixture bytes as loadCatalog.
  // A private input may be absent on a public checkout; no current-hash claim
  // can be made in that case, but old Dishes remain independently verifiable.
  let recipeHash = null;
  try {
    const fixtureHashes = {};
    for (const fixture of recipe.setup?.fixtures ?? []) {
      const source = mountedFixtures.get(fixture.mountAs);
      if (!source) throw new Error("fixture unavailable");
      fixtureHashes[fixture.id] = sha256(await readFile(source));
    }
    recipeHash = computeRecipeHash(recipe, fixtureHashes);
  } catch { /* Invalid public fixtures already have validation errors. */ }
  return { recipe, relative, recipeHash };
}

async function validateProvenance(recipeRecords) {
  const provenanceFiles = await walk("private/provenance", { allFiles: true });
  const jsonFiles = provenanceFiles.filter((file) => file.endsWith(".json"));
  const byRecipe = new Map();
  for (const relative of jsonFiles) {
    const provenance = await json(relative);
    if (!provenance || !object(provenance, relative)) continue;
    required(provenance, ["schemaVersion", "recipeId", "strangerTest"], relative);
    if (provenance.schemaVersion !== 1) fail(relative, "schemaVersion must be 1");
    string(provenance.recipeId, `${relative}.recipeId`, { pattern: IDS });
    if (path.basename(relative, ".json") !== provenance.recipeId) fail(relative, "filename must match recipeId");
    if (byRecipe.has(provenance.recipeId)) fail(relative, `duplicate provenance for ${provenance.recipeId}`);
    byRecipe.set(provenance.recipeId, { provenance, relative });

    const lineage = provenance.lineage ?? provenance.origin;
    if (provenance.lineage !== undefined && provenance.origin !== undefined && provenance.lineage !== provenance.origin) fail(relative, "lineage and origin disagree");
    enumValue(lineage, allowedOrigins, `${relative}.lineage`);
    if (!meaningful(provenance.strangerTest)) fail(relative, "strangerTest must be meaningful");
    if (![provenance.privacyReview, provenance.privacyTransformations, provenance.sanitization].some(meaningful)) {
      fail(relative, "must document privacy review, privacy transformations, or sanitization");
    }
  }

  for (const [recipeId, record] of recipeRecords) {
    const provenanceRecord = byRecipe.get(recipeId);
    if (!provenanceRecord) {
      fail(record.relative, `missing private/provenance/${recipeId}.json`);
      continue;
    }
    const lineage = provenanceRecord.provenance.lineage ?? provenanceRecord.provenance.origin;
    if (lineage !== record.recipe.origin) fail(provenanceRecord.relative, `lineage ${lineage} does not match recipe origin ${record.recipe.origin}`);
  }
  for (const [recipeId, provenance] of byRecipe) if (!recipeRecords.has(recipeId)) fail(provenance.relative, `orphan provenance for unknown recipe ${recipeId}`);
}

const exists = (target) => access(target).then(() => true, () => false);

// A Dish's receipts are sidecars outside dishHash. They are optional so an
// older Dish still validates, but when present they must be internally honest.
async function validateSidecars(relative, dish, dishDirectory, recipeRecord) {
  const inputsPath = path.join(dishDirectory, INPUTS_MANIFEST);
  const receiptPath = path.join(dishDirectory, RECEIPT_MANIFEST);
  const inputsRelative = path.relative(root, inputsPath);
  const receiptRelative = path.relative(root, receiptPath);
  if (await exists(inputsPath)) {
    const inputs = await json(inputsRelative);
    if (inputs && object(inputs, inputsRelative)) {
      onlyKeys(inputs, new Set(["schemaVersion", "recipe", "fixtures"]), inputsRelative);
      if (inputs.recipe?.id !== dish.recipe.id || inputs.recipe?.hash !== dish.recipe.hash) fail(inputsRelative, "recipe does not match the Dish");
      if (array(inputs.fixtures, `${inputsRelative}.fixtures`)) {
        for (const problem of await verifyInputs(dishDirectory, inputs)) fail(inputsRelative, problem);
      }
    }
  }
  if (!await exists(inputsPath)) {
    for (const problem of await verifyInputs(dishDirectory, { fixtures: [] })) fail(inputsRelative, problem);
  }
  if (await exists(receiptPath)) {
    const receipt = await json(receiptRelative);
    const configuration = receipt?.configuration;
    if (receipt && object(configuration, `${receiptRelative}.configuration`)) {
      if (computeConfigHash(configuration) !== dish.identity.configHash) fail(receiptRelative, "configuration does not reproduce identity.configHash");
      if (configuration.id !== dish.identity.variantId) fail(receiptRelative, "configuration id does not match identity.variantId");
      const comparisons = { provider: "provider", requestedModel: "model", harness: "harness", reasoningEffort: "reasoningEffort" };
      for (const [dishKey, variantKey] of Object.entries(comparisons)) if (dish.identity[dishKey] !== configuration[variantKey]) fail(receiptRelative, `identity.${dishKey} does not match the recorded configuration`);
      const requestedTier = dish.identity.requestedServiceTier ?? dish.identity.serviceTier;
      const observedTierRecorded = dish.identity.observedServiceTier !== undefined;
      const observedTier = observedTierRecorded ? dish.identity.observedServiceTier : dish.identity.serviceTier;
      if (requestedTier !== configuration.serviceTier) fail(receiptRelative, "identity requested service tier does not match the recorded configuration");
      if (observedTierRecorded) {
        if (dish.identity.serviceTier !== observedTier) fail(relative, "identity.serviceTier must preserve the observed service tier");
        if (!serviceTiersMatch(requestedTier, observedTier)) fail(relative, "identity service tier does not match the requested tier");
      } else if (dish.identity.requestedServiceTier !== undefined && dish.identity.serviceTier !== requestedTier) {
        fail(relative, "identity.serviceTier must preserve the requested tier when the observed tier was not recorded");
      } else if (dish.identity.requestedServiceTier === undefined && !serviceTiersMatch(requestedTier, observedTier)) {
        fail(relative, "identity service tier does not match the requested tier");
      }
    }
    if (receipt && (dish.skill || receipt.skill != null)) {
      try {
        const skill = validateSkillReceipt(receipt.skill, dish.skill);
        if (recipeRecord?.recipeHash === dish.recipe?.hash && skill.delivery === "workspace" && skill.mountAs !== (recipeRecord.recipe.skills?.mountAs ?? "skill")) fail(receiptRelative, "skill mount does not match the current Recipe contract");
      }
      catch (error) { fail(receiptRelative, error.message); }
    }
  }
}

async function validateDish(relative, recipeRecords, { privateDish = false } = {}) {
  const dish = await json(relative);
  if (!dish || !object(dish, relative)) return null;
  onlyKeys(dish, DISH_KEYS, relative);
  required(dish, ["schemaVersion", "id", "recipe", "executedAt", "finalizedAt", "identity", "status", "artifact", "validation", "dishHash"], relative);
  if (dish.schemaVersion !== 1) fail(relative, "schemaVersion must be 1");
  string(dish.id, `${relative}.id`, { pattern: DISH_IDS });
  if (path.basename(path.dirname(relative)) !== dish.id) fail(relative, "id must match dish directory");
  string(dish.executedAt, `${relative}.executedAt`);
  if (typeof dish.executedAt === "string" && (Number.isNaN(Date.parse(dish.executedAt)) || !dish.executedAt.includes("T"))) fail(relative, "executedAt must be an ISO date-time");
  string(dish.finalizedAt, `${relative}.finalizedAt`);
  if (typeof dish.finalizedAt === "string" && (Number.isNaN(Date.parse(dish.finalizedAt)) || !dish.finalizedAt.includes("T"))) fail(relative, "finalizedAt must be an ISO date-time");
  if (dish.status !== "accepted") fail(relative, "public dish status must be accepted");
  if (privateDish) {
    if (dish.visibility !== "private") fail(relative, "private Dish must declare visibility private");
  } else if ("visibility" in dish) fail(relative, "private dishes must not be published under dishes/");
  if ("skill" in dish && object(dish.skill, `${relative}.skill`)) {
    onlyKeys(dish.skill, new Set(["id", "hash"]), `${relative}.skill`);
    required(dish.skill, ["id", "hash"], `${relative}.skill`);
    string(dish.skill.id, `${relative}.skill.id`, { pattern: IDS });
    string(dish.skill.hash, `${relative}.skill.hash`, { pattern: SHA256 });
  }
  string(dish.dishHash, `${relative}.dishHash`, { pattern: SHA256 });
  const dishDirectory = path.dirname(path.join(root, relative));

  let recipeRecord;
  if (object(dish.recipe, `${relative}.recipe`)) {
    onlyKeys(dish.recipe, DISH_RECIPE_KEYS, `${relative}.recipe`);
    required(dish.recipe, ["id", "version", "hash"], `${relative}.recipe`);
    string(dish.recipe.id, `${relative}.recipe.id`, { pattern: IDS });
    string(dish.recipe.version, `${relative}.recipe.version`, { pattern: SEMVER });
    string(dish.recipe.hash, `${relative}.recipe.hash`, { pattern: SHA256 });
    recipeRecord = recipeRecords.get(dish.recipe.id);
    if (!recipeRecord) fail(relative, `unknown recipe ${dish.recipe.id}`);
    else if (privateDish !== (recipeRecord.recipe.visibility === "private")) fail(relative, "Dish storage does not match Recipe visibility");
  }

  if (object(dish.identity, `${relative}.identity`)) {
    onlyKeys(dish.identity, IDENTITY_KEYS, `${relative}.identity`);
    required(dish.identity, ["variantId", "provider", "requestedModel", "observedModel", "harness", "harnessVersion", "reasoningEffort", "serviceTier", "configHash"], `${relative}.identity`);
    for (const key of ["variantId", "provider", "requestedModel", "observedModel", "harness", "harnessVersion", "reasoningEffort", "serviceTier"]) string(dish.identity[key], `${relative}.identity.${key}`);
    for (const key of ["requestedServiceTier", "observedServiceTier"]) {
      if (dish.identity[key] !== undefined) string(dish.identity[key], `${relative}.identity.${key}`);
    }
    string(dish.identity.configHash, `${relative}.identity.configHash`, { pattern: SHA256 });
    if ("catalogHash" in dish.identity) string(dish.identity.catalogHash, `${relative}.identity.catalogHash`, { pattern: SHA256 });
    await validateSidecars(relative, dish, dishDirectory, recipeRecord);
  }

  if (object(dish.artifact, `${relative}.artifact`)) {
    onlyKeys(dish.artifact, ARTIFACT_KEYS, `${relative}.artifact`);
    required(dish.artifact, ["kind", "entry", "files", "treeHash"], `${relative}.artifact`);
    enumValue(dish.artifact.kind, allowedKinds, `${relative}.artifact.kind`);
    if (recipeRecord?.recipeHash === dish.recipe?.hash && dish.artifact.kind !== recipeRecord.recipe.kind) fail(relative, "dish artifact kind does not match recipe kind");
    safeRelative(dish.artifact.entry, `${relative}.artifact.entry`);
    if ("preview" in dish.artifact) safeRelative(dish.artifact.preview, `${relative}.artifact.preview`);
    string(dish.artifact.treeHash, `${relative}.artifact.treeHash`, { pattern: SHA256 });
    if (array(dish.artifact.files, `${relative}.artifact.files`, { min: 1 })) {
      const paths = [];
      for (const [index, file] of dish.artifact.files.entries()) {
        const item = `${relative}.artifact.files[${index}]`;
        if (!object(file, item)) continue;
        onlyKeys(file, ARTIFACT_FILE_KEYS, item);
        required(file, ["path", "sha256", "bytes"], item);
        safeRelative(file.path, `${item}.path`);
        string(file.sha256, `${item}.sha256`, { pattern: BARE_SHA256 });
        integer(file.bytes, `${item}.bytes`, 0, 104857600);
        paths.push(file.path);
        const absolute = resolveContained(dishDirectory, file.path, `${item}.path`);
        if (absolute && await regularFile(absolute, `${item}.path`)) {
          const contents = await readFile(absolute);
          if (contents.byteLength !== file.bytes) fail(item, `byte count ${file.bytes} does not match file ${contents.byteLength}`);
          if (createHash("sha256").update(contents).digest("hex") !== file.sha256) fail(item, "sha256 does not match file contents");
        }
      }
      unique(paths, `${relative}.artifact.files paths`);
      if (!paths.includes(dish.artifact.entry)) fail(relative, "artifact.entry must appear in artifact.files");
      if (dish.artifact.preview && !paths.includes(dish.artifact.preview)) fail(relative, "artifact.preview must appear in artifact.files");
    }
    try {
      const described = await describeTree(path.join(dishDirectory, "artifact"));
      if (dish.artifact.treeHash !== described.treeHash) {
        fail(`${relative}.artifact.treeHash`, "does not match the published artifact tree");
      }
    } catch (error) {
      fail(`${relative}.artifact.treeHash`, `could not hash the published artifact tree: ${error.message}`);
    }
  }

  if (object(dish.validation, `${relative}.validation`)) {
    onlyKeys(dish.validation, DISH_VALIDATION_KEYS, `${relative}.validation`);
    required(dish.validation, ["passed", "report"], `${relative}.validation`);
    if (dish.validation.passed !== true) fail(relative, "only passing dishes may be public");
    const report = resolveContained(dishDirectory, dish.validation.report, `${relative}.validation.report`);
    if (report) await regularFile(report, `${relative}.validation.report`);
  }
  if ("publicTrace" in dish) {
    const trace = resolveContained(dishDirectory, dish.publicTrace, `${relative}.publicTrace`);
    if (trace) await regularFile(trace, `${relative}.publicTrace`);
  }

  if (!privateDish) publicSafety(dish, relative);
  const { dishHash, ...dishWithoutHash } = dish;
  if (dishHash !== hashCanonical(dishWithoutHash)) {
    fail(`${relative}.dishHash`, "does not match the canonical dish manifest");
  }
  return dish;
}

async function validateReview(relative, dishes) {
  const review = await json(relative);
  if (!review || !object(review, relative)) return null;
  onlyKeys(review, REVIEW_KEYS, relative);
  required(review, ["schemaVersion", "id", "dishId", "dishHash", "reviewer", "reviewerKind", "reviewedAt", "probes"], relative);
  if (review.schemaVersion !== 1) fail(relative, "schemaVersion must be 1");
  string(review.id, `${relative}.id`, { pattern: REVIEW_IDS });
  if (`${review.id}.json` !== path.basename(relative)) fail(relative, "filename must match review id");
  string(review.dishId, `${relative}.dishId`, { pattern: DISH_IDS });
  string(review.dishHash, `${relative}.dishHash`, { pattern: SHA256 });
  string(review.reviewer, `${relative}.reviewer`, { max: 120 });
  enumValue(review.reviewerKind, allowedReviewerKinds, `${relative}.reviewerKind`);
  string(review.reviewedAt, `${relative}.reviewedAt`);
  if (typeof review.reviewedAt === "string" && (Number.isNaN(Date.parse(review.reviewedAt)) || !review.reviewedAt.includes("T"))) fail(relative, "reviewedAt must be an ISO date-time");

  const dish = dishes.get(review.dishId);
  if (!dish) fail(relative, `unknown dish ${review.dishId}`);
  else if (review.dishHash !== dish.dishHash) fail(relative, `dishHash does not match immutable dish ${review.dishId}`);

  if (array(review.probes, `${relative}.probes`, { min: 1 })) {
    const probeIds = [];
    for (const [index, probe] of review.probes.entries()) {
      const item = `${relative}.probes[${index}]`;
      if (!object(probe, item)) continue;
      onlyKeys(probe, REVIEW_PROBE_KEYS, item);
      required(probe, ["id", "device", "viewport", "verdict", "finding"], item);
      string(probe.id, `${item}.id`, { pattern: IDS });
      string(probe.device, `${item}.device`, { max: 120 });
      enumValue(probe.verdict, allowedReviewVerdicts, `${item}.verdict`);
      string(probe.finding, `${item}.finding`, { max: 1000 });
      probeIds.push(probe.id);
      if (object(probe.viewport, `${item}.viewport`)) {
        onlyKeys(probe.viewport, VIEWPORT_KEYS, `${item}.viewport`);
        required(probe.viewport, ["width", "height"], `${item}.viewport`);
        integer(probe.viewport.width, `${item}.viewport.width`, 1, 16384);
        integer(probe.viewport.height, `${item}.viewport.height`, 1, 16384);
        if (probe.viewport.deviceScaleFactor !== undefined) number(probe.viewport.deviceScaleFactor, `${item}.viewport.deviceScaleFactor`, Number.MIN_VALUE, 8);
      }
      if (probe.details !== undefined && object(probe.details, `${item}.details`)) {
        onlyKeys(probe.details, PROBE_DETAILS_KEYS, `${item}.details`);
        if (probe.details.method !== undefined) string(probe.details.method, `${item}.details.method`, { max: 120 });
        if (probe.details.path !== undefined) safeRelative(probe.details.path, `${item}.details.path`);
        if (probe.details.scrollWidth !== undefined) integer(probe.details.scrollWidth, `${item}.details.scrollWidth`, 0, 1000000);
        if (probe.details.clientWidth !== undefined) integer(probe.details.clientWidth, `${item}.details.clientWidth`, 0, 1000000);
      }
    }
    unique(probeIds, `${relative}.probes ids`);
  }
  publicSafety(review, relative);
  return review;
}

// Mounted skill sources are third-party public code. They are scanned for
// leaked credentials and private machine paths, not for prose conventions.
const skillSourcePatterns = new Set(["private Unix home path", "private Windows home path", "private key", "provider credential variable", "API-key-like value", "private evidence ID"]);

async function scanPublicCatalog() {
  const files = await walk("catalog", { allFiles: true });
  for (const relative of files) {
    const absolute = path.join(root, relative);
    const contents = await readFile(absolute);
    if (contents.includes(0)) continue;
    const text = contents.toString("utf8");
    if (/^catalog\/skills\/[^/]+\/files\//.test(relative.split(path.sep).join("/"))) {
      for (const { name, pattern } of publicLeakPatterns) if (skillSourcePatterns.has(name) && pattern.test(text)) fail(relative, `public-safety scan matched ${name}`);
      continue;
    }
    scanText(text, relative);
  }
}

const recipeSchema = await json("catalog/recipe.schema.json");
const dishSchema = await json("catalog/dish.schema.json");
const reviewSchema = await json("catalog/review.schema.json");
if (recipeSchema?.properties?.harness?.properties?.capabilities?.items?.enum?.join("\0") !== [...allowedCapabilities].join("\0")) {
  fail("catalog/recipe.schema.json", "capability enum disagrees with runtime validator");
}
if (dishSchema?.properties?.artifact?.properties?.kind?.enum?.join("\0") !== [...allowedKinds].join("\0")) {
  fail("catalog/dish.schema.json", "artifact kind enum disagrees with runtime validator");
}
if (reviewSchema?.properties?.probes?.items?.properties?.verdict?.enum?.join("\0") !== [...allowedReviewVerdicts].join("\0")) {
  fail("catalog/review.schema.json", "verdict enum disagrees with runtime validator");
}
if (reviewSchema?.properties?.reviewerKind?.enum?.join("\0") !== [...allowedReviewerKinds].join("\0")) {
  fail("catalog/review.schema.json", "reviewerKind enum disagrees with runtime validator");
}

const cuisinesDoc = await json("catalog/cuisines.json");
const tagsDoc = await json("catalog/tags.json");
const variantsDoc = await json("catalog/configurations.json");
const cuisines = validateCuisines(cuisinesDoc);
const tags = validateTags(tagsDoc);
const variants = validateConfigurations(variantsDoc);
const skillsDoc = (await walk("catalog", { basename: "skills.json" })).length ? await json("catalog/skills.json") : null;
const skills = await validateSkills(skillsDoc);

const recipeFiles = await walk("catalog/recipes", { basename: "recipe.json" });
const recipeRecords = new Map();
for (const relative of recipeFiles.sort()) {
  const record = await validateRecipe(relative, cuisines, tags, skills);
  if (!record) continue;
  if (recipeRecords.has(record.recipe.id)) fail(relative, `duplicate recipe id ${record.recipe.id}`);
  recipeRecords.set(record.recipe.id, record);
}

if (!publicCheckout) await validateProvenance(recipeRecords);

const dishFiles = await walk("dishes", { basename: "dish.json" });
const dishes = new Map();
for (const relative of dishFiles.sort()) {
  const dish = await validateDish(relative, recipeRecords);
  if (!dish) continue;
  if (dishes.has(dish.id)) fail(relative, `duplicate dish id ${dish.id}`);
  dishes.set(dish.id, dish);
}

// Owner validation covers private accepted artifacts with the same immutable
// manifest, bytes, receipt and tree checks. Public checkouts never read them.
const privateDishFiles = publicCheckout ? [] : await walk("private/dishes", { basename: "dish.json" });
const allDishIds = new Set(dishes.keys());
for (const relative of privateDishFiles.sort()) {
  const dish = await validateDish(relative, recipeRecords, { privateDish: true });
  if (!dish) continue;
  if (allDishIds.has(dish.id)) fail(relative, `duplicate dish id ${dish.id}`);
  allDishIds.add(dish.id);
}

const reviewFiles = await walk("reviews", { allFiles: true });
const reviewIds = new Set();
for (const relative of reviewFiles.sort()) {
  if (path.extname(relative) !== ".json") {
    fail(relative, "review directory may contain only JSON files");
    continue;
  }
  const review = await validateReview(relative, dishes);
  if (!review) continue;
  if (reviewIds.has(review.id)) fail(relative, `duplicate review id ${review.id}`);
  reviewIds.add(review.id);
}

let axisSets = [];
try {
  axisSets = await loadAxisSets(root);
  await loadObservations(root, { dishes: [...dishes.values()], axisSets });
} catch (error) {
  fail("observations", error.message);
}

await scanPublicCatalog();

if (errors.length) {
  console.error(`Catalog validation failed with ${errors.length} error${errors.length === 1 ? "" : "s"}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Catalog valid: ${cuisines.size} cuisines, ${tags.size} tags, ${variants.size} configurations, ${skills.size} skills, ${recipeRecords.size} recipes, ${dishes.size} dishes, ${reviewIds.size} artifact review${reviewIds.size === 1 ? "" : "s"}, ${axisSets.length} axis sets, ${publicCheckout ? "private provenance skipped (--public-checkout)" : `${recipeRecords.size} private provenance records checked`}.`);
