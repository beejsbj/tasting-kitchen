import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

import { loadCatalog, resolveVariant } from "../lib/taste/catalog.mjs";
import { classifyFailure } from "../lib/taste/faults.mjs";
import { publishNoDish } from "../lib/taste/no-dishes.mjs";
import { buildRegistry } from "../lib/taste/registry.mjs";
import { writeVerdict } from "../lib/taste/verdicts.mjs";

/**
 * Browser check for outcomes: a No Dish in its pane, on the counter and in
 * Menu coverage, the outcome filter, and Burooj's verdict leading a Dish.
 * The fixture is built from the shipped catalog plus two synthetic No Dishes
 * and one verdict, in a temporary copy; nothing in the checkout changes.
 *
 *   TASTE_BROWSER_URL=http://127.0.0.1:PORT [TASTE_BROWSER_SCREENSHOTS=DIR] node scripts/verify-outcomes-browser.mjs
 */
const base = process.env.TASTE_BROWSER_URL;
if (!base) throw new Error("Set TASTE_BROWSER_URL to a preview server of your own");
const screenshotDir = process.env.TASTE_BROWSER_SCREENSHOTS;
if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true });
const root = path.resolve(import.meta.dirname, "..");
const SANDBOX = "sandbox allow-scripts allow-forms; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'";

async function fixture() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "taste-outcomes-"));
  for (const directory of ["catalog", "dishes", "reviews"]) await fs.cp(path.join(root, directory), path.join(temporary, directory), { recursive: true });
  const catalog = await loadCatalog(temporary);
  const variant = resolveVariant(catalog, "codex-sol-high");
  const plate = async (recipeId, fault, { checks = null, files = {}, turns } = {}) => {
    const recipe = catalog.recipes.find((candidate) => candidate.id === recipeId);
    const attemptId = `attempt_${recipeId}_codex-sol-high_20261109090000000_browser`;
    const attemptDir = path.join(temporary, "private/runtime/attempts", attemptId);
    const workspace = path.join(attemptDir, "workspace");
    await fs.mkdir(workspace, { recursive: true });
    for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(workspace, name), text);
    return publishNoDish({
      repoRoot: temporary, catalog, recipe, variant, attemptId, attemptDir, workspace, checks,
      result: { cliVersion: "codex-cli 9.9.9-fixture", failure: fault.code === "refused" ? { turnId: recipe.turns[0].id } : null, turns: turns ?? recipe.turns.map(() => ({ finalMessage: "I built the page, but stopped before the second section." })) },
      observed: { model: variant.model }, fault, executedAt: "2026-11-09T09:00:00.000Z",
    });
  };
  const web = catalog.recipes.find((recipe) => recipe.id === "fresh-product-span");
  const required = web.validation.checks.filter((check) => check.required);
  await plate("fresh-product-span", classifyFailure({ stage: "validation", chefFault: "checks-failed" }), {
    checks: { passed: false, checks: required.map((check, index) => ({ ...check, passed: index !== 0, detail: index === 0 ? "command exited 1" : "command exited 0" })) },
    files: { "index.html": "<!doctype html><title>Span</title><h1>Span</h1><p>Half a page.</p>" },
  });
  await plate("respond-to-short-journal", classifyFailure({ chefFault: "refused" }), { turns: [{ finalMessage: null }] });
  const cursorDish = (await fs.readdir(path.join(temporary, "dishes"))).find((id) => id.startsWith("dish_fresh-product-span_cursor"));
  await writeVerdict(temporary, { dishId: cursorDish, verdict: "failed", note: "Looks finished, but the pricing table is a screenshot of text: nothing on it can be read by a screen reader.", now: new Date("2026-11-09T10:00:00.000Z") });
  const { registry } = await buildRegistry({ repoRoot: temporary });
  return { temporary, registry, cursorDish };
}

const { temporary, registry, cursorDish } = await fixture();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/data/registry.json", (route) => route.fulfill({ json: registry }));
  await context.route(/\/(?:dishes|data\/fixtures)\//u, async (route) => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//u, "");
    const file = path.resolve(temporary, "public", relative);
    if (!file.startsWith(path.join(temporary, "public") + path.sep)) return route.abort();
    await route.fulfill({ path: file, headers: { "Access-Control-Allow-Origin": "*", ...(relative.startsWith("dishes/") ? { "Content-Security-Policy": SANDBOX } : {}) } });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const save = (name) => screenshotDir ? page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: false }) : undefined;
  const settle = () => page.waitForTimeout(700);

  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  assert.equal(await page.locator('.dish-card[data-outcome="no-dish"]').count(), 2, "both No Dishes are on the counter");
  assert.equal(await page.locator('.dish-card[data-outcome="failed-by-burooj"]').count(), 1);
  assert.ok(await page.getByRole("group", { name: "Filter by outcome" }).isVisible());
  await settle();
  if (screenshotDir) {
    await page.locator('.dish-card[data-outcome="no-dish"]').first().screenshot({ path: path.join(screenshotDir, "counter-no-dish-card.png") });
    await page.locator('.dish-card[data-outcome="failed-by-burooj"]').screenshot({ path: path.join(screenshotDir, "counter-failed-by-burooj-card.png") });
  }

  await page.getByRole("group", { name: "Filter by outcome" }).getByRole("button", { name: "No Dish", exact: true }).click();
  await settle();
  assert.equal(await page.locator(".dish-card").count(), 2, "the No Dish filter shows only No Dishes");
  assert.match(page.url(), /outcome=no-dish/u);
  await save("counter-no-dish-filter");

  await page.goto(`${base}/?outcome=failed-by-burooj`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".dish-card").count(), 1);

  const luna = registry.dishes.find((dish) => dish.id.startsWith("dish_fresh-product-span_codex-luna"));
  const noDish = registry.noDishes.find((plate) => plate.recipe.id === "fresh-product-span");
  await page.goto(`${base}/?recipe=fresh-product-span&models=codex-luna-xhigh,cursor-composer-2-5,codex-sol-high&dishes=${luna.id},${cursorDish},${noDish.id}`, { waitUntil: "networkidle" });
  await settle();
  assert.equal(await page.locator('.artifact-pane--no-dish').count(), 1, "the No Dish sits in its pane");
  assert.match(await page.locator(".verdict-mark").innerText(), /Failed by Burooj/u);
  assert.match(await page.locator(".verdict-mark").innerText(), /Automated checks passed/u);
  await save("compare-panes");

  await page.goto(`${base}/?recipe=fresh-product-span&models=codex-sol-high&dishes=${noDish.id}`, { waitUntil: "networkidle" });
  await settle();
  assert.match(await page.locator(".no-dish").innerText(), /did not pass the Recipe's required checks/u);
  await save("no-dish-pane");
  await page.getByRole("button", { name: "Configuration receipts" }).click();
  await settle(); await save("no-dish-receipt");
  await page.keyboard.press("Escape");

  await page.goto(`${base}/?recipe=fresh-product-span&models=cursor-composer-2-5&dishes=${cursorDish}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Your verdict" }).click();
  await settle();
  await page.getByLabel("Note").fill("It scores well");
  await settle();
  assert.match(await page.getByRole("alert").innerText(), /numerical ranking language/u, "an unpublishable note is caught before saving");
  await page.getByLabel("Note").fill("The table is an image of text.");
  await save("verdict-control");
  await page.keyboard.press("Escape");

  await page.goto(`${base}/?view=menus&menu=fresh-visual-ui`, { waitUntil: "networkidle" });
  await settle();
  assert.ok(await page.locator('.coverage-table td[data-outcome="no-dish"]').count() >= 1, "Menu coverage shows the No Dish cell");
  await page.locator('.coverage-table td[data-outcome="no-dish"]').first().scrollIntoViewIfNeeded();
  await save("menu-coverage");

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.route("**/data/registry.json", (route) => route.fulfill({ json: registry }));
  await phone.goto(`${base}/?recipe=respond-to-short-journal&models=codex-sol-high`, { waitUntil: "networkidle" });
  await phone.waitForTimeout(700);
  assert.match(await phone.locator(".no-dish").innerText(), /The model declined the Recipe/u);
  if (screenshotDir) await phone.screenshot({ path: path.join(screenshotDir, "no-dish-refused-phone.png") });
  assert.deepEqual(errors, []);
  console.log("Outcome browser check passed.");
} finally {
  await browser.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
