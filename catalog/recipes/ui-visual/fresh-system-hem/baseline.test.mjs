// Authoring verification only: uses the repository's installed Playwright.
// The cooked recipe validator itself uses only Node built-ins.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, copyFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";

const recipe = JSON.parse(await readFile(new URL("./recipe.json", import.meta.url), "utf8"));
test("Hem supplied baseline renders and its existing contexts work at both widths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hem-baseline-"));
  let browser;
  const server = createServer(async (request, response) => {
    const relative = new URL(request.url, "http://localhost").pathname.slice(1) || "index.html";
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
    try {
      const bytes = await readFile(filename);
      const mime = { ".html": "text/html", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" }[path.extname(filename)] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": mime }).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  try {
    for (const fixture of recipe.setup.fixtures.filter(f => f.editable || f.mountAs.startsWith("data/"))) {
      const target = path.join(root, fixture.mountAs);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(import.meta.dirname, fixture.path), target);
    }
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--no-sandbox"] });
    for (const width of [360, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByRole("button", { name: "Open H-041", exact: true }).waitFor();
      assert.equal(await page.locator(".hem-ticket").count(), 3);
      for (const id of ["H-041", "H-042", "H-043"]) {
        await page.getByRole("button", { name: `Open ${id}`, exact: true }).click();
        assert.equal(await page.getByRole("heading", { name: "Bench note", exact: true }).count(), 1);
        assert.equal(await page.evaluate(() => document.activeElement.id), "content");
        await page.getByRole("button", { name: "Back to queue", exact: true }).click();
      }
      await page.getByRole("button", { name: "Materials", exact: true }).click();
      assert.equal(await page.getByRole("heading", { name: "Concealed zip", exact: true }).count(), 1);
      await page.getByRole("button", { name: "Primitives", exact: true }).click();
      await page.getByLabel("Bench note", { exact: true }).fill("Keep the hand stitching");
      await page.getByRole("button", { name: "Try action", exact: true }).click();
      assert.equal(await page.getByRole("status").textContent(), "Sample: Keep the hand stitching");
      assert.equal(await page.getByRole("button", { name: "Unavailable", exact: true }).isDisabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.equal(await page.locator(".hem-ticket").evaluate(node => getComputedStyle(node).backgroundColor), "rgb(255, 253, 247)");
      await page.getByRole("button", { name: "Repair queue", exact: true }).click();
      assert.equal(await page.locator(".hem-ticket").count(), 3);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
