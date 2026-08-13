import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { EXPORT_FORMAT, RECORD_FORMAT, exportRecords, importRecords, isRecordComplete } from "../app/kitchen-storage.mjs";

const sample = {
  format: RECORD_FORMAT, id: "saved-run-1", createdAt: "2026-08-13T12:00:00.000Z", updatedAt: "2026-08-13T12:00:00.000Z",
  flightId: "map-the-fog-before-the-fix", flightTitle: "Map the fog before the fix", family: "Technical", flightVersion: "1.0.0",
  dishId: "degraded-compose-topology", dishTitle: "A degraded service", dishVersion: "1.0.0", modelLabel: "Example model", configuration: "Careful mode", reflection: "Keep the distinction visible.",
  turns: [{ turnId: "initial-prompt", label: "Map the situation", kind: "prompt", prompt: "A prompt", response: "A response", note: "A note" }],
};

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("empty-kitchen surface is replaced with the tasting workflow", async () => {
  const [page, layout, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"), readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"), readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Choose a flight/); assert.match(page, /Copy prompt/); assert.match(page, /Save this run locally/); assert.match(page, /Export JSON/); assert.match(page, /Import JSON/); assert.match(page, /Comparison is intentionally limited to two runs/);
  assert.match(page, /import\.meta\.glob/); assert.match(layout, /Model Tasting Kitchen/); assert.match(layout, /og\.png/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/); assert.match(css, /@media \(max-width:760px\)/);
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Model Tasting Kitchen/);
  assert.match(html, /Choose a flight/);
  assert.match(html, /Copy prompt/);
});

test("records export and import without overwriting existing notebook entries", () => {
  assert.equal(isRecordComplete(sample), true);
  const payload = exportRecords([sample]);
  assert.equal(JSON.parse(payload).format, EXPORT_FORMAT);
  const imported = importRecords(payload, []);
  assert.equal(imported.accepted, true); assert.equal(imported.imported, 1); assert.deepEqual(imported.records, [sample]);
  const duplicate = importRecords(payload, [sample]);
  assert.equal(duplicate.imported, 0); assert.equal(duplicate.skipped, 1); assert.deepEqual(duplicate.records, [sample]);
  const malformed = importRecords("not json", [sample]);
  assert.equal(malformed.accepted, false); assert.deepEqual(malformed.records, [sample]);
  const badShape = importRecords(JSON.stringify({ format: EXPORT_FORMAT, records: [{ id: "nope" }] }), [sample]);
  assert.equal(badShape.accepted, true); assert.equal(badShape.imported, 0); assert.deepEqual(badShape.records, [sample]);
});
