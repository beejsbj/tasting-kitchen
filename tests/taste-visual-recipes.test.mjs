import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateWorkspace as validateLaunch } from "../catalog/recipes/ui-visual/responsive-product-launch/validate-output.mjs";
import { validateWorkspace as validateEditorial } from "../catalog/recipes/ui-visual/editorial-culture-feature/validate-output.mjs";
import { validateWorkspace as validateRitual } from "../catalog/recipes/ui-visual/shared-result-ritual/validate-output.mjs";
import { validateWorkspace as validateSystem } from "../catalog/recipes/ui-visual/extend-design-system-without-flattening-it/validate-output.mjs";

async function temp(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-validator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, relative, value) {
  const filename = path.join(root, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
}

test("general web validators accept nonempty module-based output", async (t) => {
  const root = await temp(t);
  await put(root, "index.html", '<link rel="stylesheet" href="styles.css"><script type="module" src="app.js"></script>');
  await put(root, "styles.css", "body { color: black; }");
  await put(root, "app.js", 'import "./feature.js"; document.body.append("ready");');
  await put(root, "feature.js", "export const ready = true;");
  await assert.doesNotReject(validateLaunch(root));
  await assert.doesNotReject(validateRitual(root));
});

test("general web validators reject empty files and invalid module syntax", async (t) => {
  const root = await temp(t);
  await put(root, "index.html", "<main>Ready</main>");
  await put(root, "styles.css", "");
  await assert.rejects(validateLaunch(root), /Empty published file/);
  await put(root, "styles.css", "body{}");
  await put(root, "app.js", "export const = ;");
  await assert.rejects(validateRitual(root), /JavaScript syntax failed/);
});

test("editorial validator requires the published map asset", async (t) => {
  const root = await temp(t);
  await put(root, "index.html", "<article>Feature</article>");
  await put(root, "assets/night-map.svg", "<svg></svg>");
  await assert.doesNotReject(validateEditorial(root));
  await rm(path.join(root, "assets/night-map.svg"));
  await assert.rejects(validateEditorial(root), /Missing published assets\/night-map\.svg/);
});

async function designWorkspace(t) {
  const root = await temp(t);
  await put(root, "index.html", '<link rel="stylesheet" href="src/tokens.css"><script type="module" src="styleguide.js"></script>');
  await put(root, "styleguide.js", 'import "./src/components.js"; import "./src/signal-panel.js";');
  await put(root, "styles.css", "body{}");
  await put(root, "src/components.js", "export function StateMark() {}");
  await put(root, "src/signal-panel.js", "export function Arc() {}");
  await put(root, "src/tokens.css", ":root{--brass:#a66b18}");
  await put(root, "system-decisions.json", {
    promote: { symbol: "StateMark", source: "src/components.js", reason: "Repeated across contexts." },
    prune: { symbol: "Pair", source: "src/components.js", reason: "One use does not earn a shared API." },
    keepLocal: { symbol: "Arc", source: "src/signal-panel.js", reason: "Behavior remains feature-owned." },
  });
  return root;
}

test("design validator accepts link-based tokens and valid decision metadata", async (t) => {
  const root = await designWorkspace(t);
  await assert.doesNotReject(validateSystem(root));
});

test("design validator rejects duplicate symbols, traversal, missing reasons, and invalid JavaScript", async (t) => {
  const root = await designWorkspace(t);
  const valid = JSON.parse(await readFile(path.join(root, "system-decisions.json"), "utf8"));

  await put(root, "system-decisions.json", { ...valid, prune: { ...valid.prune, symbol: valid.promote.symbol } });
  await assert.rejects(validateSystem(root), /symbols must be distinct/);
  await put(root, "system-decisions.json", { ...valid, keepLocal: { ...valid.keepLocal, source: "src/../secret.js" } });
  await assert.rejects(validateSystem(root), /Invalid keepLocal source path/);
  await put(root, "system-decisions.json", { ...valid, promote: { ...valid.promote, reason: "" } });
  await assert.rejects(validateSystem(root), /Missing promote reason/);
  await put(root, "system-decisions.json", valid);
  await put(root, "src/components.js", "export const = ;");
  await assert.rejects(validateSystem(root), /JavaScript syntax failed/);
});

test("web validation follows published paths, excluding working notes", async (t) => {
  const root = await temp(t);
  await put(root, "index.html", "<main>Sample</main>");
  await put(root, "notes/scratch.js", "not valid JavaScript !!!");
  await put(root, "notes.md", "");
  await assert.doesNotReject(validateLaunch(root));
  await assert.doesNotReject(validateRitual(root));
  await put(root, "assets/nested/app.js", "export const = ;");
  await assert.rejects(validateLaunch(root), /JavaScript syntax failed/);
});

test("system validator checks nested published modules and additional root scripts", async (t) => {
  const root = await designWorkspace(t);
  await put(root, "src/feature/nested.js", "export const = ;");
  await assert.rejects(validateSystem(root), /JavaScript syntax failed/);
  await put(root, "src/feature/nested.js", "export const sample = 1;");
  await put(root, "extra.js", "export const = ;");
  await assert.rejects(validateSystem(root), /JavaScript syntax failed/);
  await put(root, "extra.js", "export const sample = 1;");
  await put(root, "src/empty.css", "");
  await assert.rejects(validateSystem(root), /Empty published file/);
});
