import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  EXPORT_FORMAT, LEGACY_EXPORT_FORMAT, LEGACY_RECORD_FORMAT, RECORD_FORMAT, assetDownloadDetails,
  comparisonEligibility, exportRecords, importRecords, isRecordComplete,
} from "../app/kitchen-storage.mjs";

const legacyRun = {
  format: LEGACY_RECORD_FORMAT, id: "saved-run-v1", createdAt: "2026-08-13T12:00:00.000Z", updatedAt: "2026-08-13T12:00:00.000Z",
  flightId: "thinking-aloud-without-stealing-the-thought", flightTitle: "Thinking aloud", family: "Conversation", flightVersion: "1.0.0",
  dishId: "bridge-changes-material", dishTitle: "A bridge", dishVersion: "1.0.0", modelLabel: "Earlier model", configuration: "", reflection: "Keep the relation live.",
  turns: [{ turnId: "offer", label: "Offer", kind: "prompt", prompt: "A prompt", response: "A response", note: "A note" }],
};
const currentRun = {
  ...legacyRun, format: RECORD_FORMAT, id: "saved-run-v2", dishVersion: "2.0.0", activityMode: "conversation", claimBoundary: "response-preference",
  harness: { mode: "none", mechanics: [], separationNote: "No persistent mechanism is assessed." },
  turns: [{ ...legacyRun.turns[0], stage: "receive" }],
};

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("the kitchen surface is manual, schema-v2 aware, and server-renders", async () => {
  const [page, layout, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"), readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"), readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  for (const phrase of ["Choose a flight", "Copy prompt", "Copy asset", "Open fixture", "Download fixture", "Copy URL", "publicFixtureUrl", "asset.usage", "Save this run locally", "Export JSON", "Import JSON", "activityMode", "claimBoundary", "separationNote", "humanJudgmentRequired", "reducedMotionCheck", "mode-transition"]) assert.match(page, new RegExp(phrase));
  assert.match(page, /import\.meta\.glob/); assert.doesNotMatch(page, /<span>Family<\/span>/); assert.match(layout, /Model Tasting Kitchen/); assert.match(layout, /og\.png/);
  assert.match(css, /kind-mode-transition/); assert.match(css, /mode-transition-card/); assert.match(css, /@media \(max-width:760px\)/);
  const response = await render(); assert.equal(response.status, 200);
  const html = await response.text(); assert.match(html, /Model Tasting Kitchen/); assert.match(html, /Choose a flight/); assert.match(html, /Copy prompt/);
});

test("all nine flights and 27 dishes carry the schema-v2 distinctions", async () => {
  const root = new URL("../library/flights/", import.meta.url);
  const files = (await readdir(root)).filter((file) => file.endsWith(".json")).sort();
  assert.equal(files.length, 9);
  const flights = await Promise.all(files.map(async (file) => JSON.parse(await readFile(new URL(file, root), "utf8"))));
  assert.equal(flights.reduce((total, flight) => total + flight.dishes.length, 0), 27);
  assert.ok(flights.every((flight) => flight.formatVersion === "2.0.0" && flight.evidenceBasis.claimBoundary && flight.evidenceBasis.provenanceCaution));
  const dishes = flights.flatMap((flight) => flight.dishes);
  assert.ok(dishes.every((dish) => dish.activityMode && dish.harness?.mode && dish.harness?.separationNote && dish.interactionRequirements && typeof dish.humanJudgmentRequired === "boolean"));
  assert.ok(dishes.some((dish) => dish.turns.some((turn) => turn.kind === "mode-transition" && turn.stage)));
  const assets = flights.flatMap((flight) => [flight.setup, ...flight.dishes.map((dish) => dish.setup)]).flatMap((setup) => setup.assets);
  for (const asset of assets) {
    assert.ok(asset.id && asset.title && asset.kind && asset.content);
    if (asset.kind === "public-fixture") {
      assert.match(asset.path, /^public\/fixtures\//); assert.ok(asset.usage);
      await access(new URL(`../${asset.path}`, import.meta.url));
      continue;
    }
    const download = assetDownloadDetails(asset);
    assert.match(download.filename, /\.(?:txt|html|svg)$/); assert.match(download.type, /^(?:text\/plain|text\/html|image\/svg\+xml)$/);
  }
  assert.ok(assets.some((asset) => asset.kind === "public-fixture"));
});

test("v1 remains readable while v2 export/import preserves current context", () => {
  assert.equal(isRecordComplete(legacyRun), true); assert.equal(isRecordComplete(currentRun), true);
  const legacyImport = importRecords(JSON.stringify({ format: LEGACY_EXPORT_FORMAT, records: [legacyRun] }), []);
  assert.equal(legacyImport.accepted, true); assert.equal(legacyImport.imported, 1); assert.deepEqual(legacyImport.records, [legacyRun]);
  const payload = exportRecords([legacyRun, currentRun]);
  assert.equal(JSON.parse(payload).format, EXPORT_FORMAT);
  const imported = importRecords(payload, []);
  assert.equal(imported.imported, 2); assert.deepEqual(imported.records, [legacyRun, currentRun]);
  const duplicate = importRecords(payload, [currentRun]);
  assert.equal(duplicate.imported, 1); assert.equal(duplicate.skipped, 1);
  const malformed = importRecords("not json", [currentRun]);
  assert.equal(malformed.accepted, false); assert.deepEqual(malformed.records, [currentRun]);
});

test("comparison remains limited to equivalent dish versions", () => {
  assert.deepEqual(comparisonEligibility([legacyRun]), { allowed: true, reason: "" });
  assert.deepEqual(comparisonEligibility([currentRun, { ...currentRun, id: "same-dish" }]), { allowed: true, reason: "" });
  assert.equal(comparisonEligibility([currentRun, { ...currentRun, id: "different-dish", dishId: "another-dish" }]).allowed, false);
  assert.equal(comparisonEligibility([currentRun, { ...currentRun, id: "different-version", dishVersion: "9.0.0" }]).allowed, false);
});
