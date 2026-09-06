import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Temporary structural doubles, not solved websites or browser-quality evidence.
const shell = '<!doctype html><html lang="en"><head><title>Validator test</title><link rel="stylesheet" href="./styles.css"></head><body><main>Test shell</main><script type="module" src="./app.mjs"></script></body></html>';
async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "standard-web-validator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"));
  await mkdir(path.join(root, "validation"));
  await copyFile(new URL("./validation/validate-output.mjs", import.meta.url), path.join(root, "validation/validate-output.mjs"));
  await copyFile(new URL("./fixtures/content.json", import.meta.url), path.join(root, "data/content.json"));
  await writeFile(path.join(root, "index.html"), shell);
  await writeFile(path.join(root, "styles.css"), "body { margin: 0; }");
  await writeFile(path.join(root, "app.mjs"), "export {};\n");
  return root;
}
function run(root) {
  return spawnSync(process.execPath, ["validation/validate-output.mjs"], { cwd: root, encoding: "utf8" });
}

test("mounted command accepts a minimal structural double", async (t) => {
  const result = run(await workspace(t));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Browser behavior and visual quality still need human review/u);
});

const negatives = [
  ["missing output", (root) => rm(path.join(root, "index.html")), /Missing output/u],
  ["whitespace-only output", (root) => writeFile(path.join(root, "styles.css"), " \n"), /Empty output/u],
  ["invalid content JSON", (root) => writeFile(path.join(root, "data/content.json"), "{"), /SyntaxError/u],
  ["invalid JavaScript", (root) => writeFile(path.join(root, "app.mjs"), "const = ;"), /JavaScript syntax failed/u],
  ["missing main landmark", (root) => writeFile(path.join(root, "index.html"), shell.replace("<main>", "<div>").replace("</main>", "</div>")), /Missing HTML document shell/u],
  ["disconnected module", (root) => writeFile(path.join(root, "index.html"), shell.replace('src="./app.mjs"', 'src="./other.mjs"')), /must load app.mjs/u],
  ["remote runtime script", (root) => writeFile(path.join(root, "index.html"), shell.replace("</body>", '<script src="https://cdn.example/framework.js"></script></body>')), /Nonlocal resource/u],
  ["missing CSS asset", (root) => writeFile(path.join(root, "styles.css"), 'body { background: url("assets/missing.svg"); }'), /Missing or unpublished resource/u],
];
for (const [label, mutate, expected] of negatives) {
  test(`mounted command rejects ${label}`, async (t) => {
    const root = await workspace(t);
    await mutate(root);
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  });
}

test("required runtime input and immutable validator have the right publication boundary", async () => {
  const recipe = JSON.parse(await readFile(new URL("./recipe.json", import.meta.url), "utf8"));
  assert.ok(recipe.output.include.includes("data/content.json"));
  assert.ok(!recipe.output.include.some((entry) => entry.startsWith("validation/")));
  assert.ok(recipe.setup.fixtures.every((fixture) => fixture.public && fixture.editable === false));
});
