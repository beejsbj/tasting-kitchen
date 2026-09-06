// Validator tests use explicit lookup doubles, never a finished candidate UI.
// Temporary shells are deleted and are not published or used as taste evidence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateLogic, validateStatic } from "./validation/mechanics.mjs";

const recipeRoot = import.meta.dirname;
const recipe = JSON.parse(await readFile(path.join(recipeRoot, "recipe.json"), "utf8"));
const contract = JSON.parse(await readFile(path.join(recipeRoot, "validation/contract.json"), "utf8"));
const cases = JSON.parse(await readFile(path.join(recipeRoot, "validation/cases.json"), "utf8"));
function lookupApi() {
  return Object.fromEntries([...new Set(cases.map(c => c.fn))].map(fn => [fn, (...args) => {
    const vector = cases.find(c => c.fn === fn && JSON.stringify(c.args) === JSON.stringify(args));
    assert.ok(vector, "Lookup double received an undeclared input");
    if (vector.throws) throw new RangeError("Deliberate invalid-input response");
    return structuredClone(vector.expected);
  }]));
}
async function shell() {
  const root = await mkdtemp(path.join(os.tmpdir(), "fresh-validator-"));
  for (const fixture of recipe.setup.fixtures) {
    const target = path.join(root, fixture.mountAs);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(recipeRoot, fixture.path), target);
  }
  for (const filename of contract.required) {
    if (contract.immutable[filename]) continue;
    await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
    let contents = filename.endsWith(".mjs") ? "export {};" : "Validator fixture only.";
    if (filename === "index.html") contents = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="./styles.css"></head><body><script type="module" src="./app.mjs"></script></body></html>';
    else {
      for (const [from, to] of contract.edges.filter(([from]) => from === filename)) {
        let ref = path.posix.relative(path.posix.dirname(from), to);
        if (!ref.startsWith(".")) ref = `./${ref}`;
        contents += filename.endsWith(".css") ? `\n@import "${ref}";` : to.endsWith(".json") ? `\nfetch("${ref}");` : `\nimport "${ref}";`;
      }
    }
    await writeFile(path.join(root, filename), contents);
  }
  const names = [...new Set(cases.map(c => c.fn))];
  const logic = `const cases = ${JSON.stringify(cases)};\nconst invoke = (fn, args) => { const item = cases.find(c => c.fn === fn && JSON.stringify(c.args) === JSON.stringify(args)); if (!item) throw new Error("Missing test double"); if (item.throws) throw new RangeError("Invalid input double"); return structuredClone(item.expected); };\n${names.map(fn => `export const ${fn} = (...args) => invoke("${fn}", args);`).join("\n")}`;
  await writeFile(path.join(root, "logic.mjs"), logic);
  return root;
}
async function withShell(fn) {
  const root = await shell();
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test(`${recipe.id}: accept declared behavior vectors`, () => validateLogic(lookupApi(), cases));
test("reject wrong answers and missing exceptions for every vector", () => {
  for (const vector of cases) {
    const api = { [vector.fn]: () => ({ deliberatelyWrong: true }) };
    assert.throws(() => validateLogic(api, [vector]), undefined, vector.label);
  }
});
test("reject mutated caller data even with the right returned value", () => {
  const vector = cases.find(c => !c.throws && c.args[0] && typeof c.args[0] === "object");
  const api = { [vector.fn]: (...args) => {
    if (Array.isArray(args[0])) args[0].push("mutation"); else args[0].changed = true;
    return structuredClone(vector.expected);
  } };
  assert.throws(() => validateLogic(api, [vector]), /Input mutation/);
});
test("execute the actual mounted validator command against a positive shell", async () => withShell(async root => {
  const result = spawnSync(process.execPath, ["validation/validate-output.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { passed: true, vectors: cases.length, browserVerified: false });
}));
test("reject missing output", async () => withShell(async root => {
  await rm(path.join(root, "styles.css"));
  await assert.rejects(validateStatic(root, contract), /ENOENT/);
}));
test("reject syntax errors", async () => withShell(async root => {
  await writeFile(path.join(root, "logic.mjs"), "export const broken = ;");
  await assert.rejects(validateStatic(root, contract), /logic.mjs/);
}));
test("reject disconnected app module", async () => withShell(async root => {
  await writeFile(path.join(root, "app.mjs"), "export {};");
  await assert.rejects(validateStatic(root, contract), /Missing actual import/);
}));
test("reject changed immutable facts", async () => withShell(async root => {
  const filename = Object.keys(contract.immutable)[0];
  await writeFile(path.join(root, filename), "{}\n");
  await assert.rejects(validateStatic(root, contract), /Immutable snapshot changed/);
}));
test("reject unavailable dependency imports", async () => withShell(async root => {
  await writeFile(path.join(root, "logic.mjs"), 'import "unavailable-package";');
  await assert.rejects(validateStatic(root, contract), /Use local relative resources/);
}));
