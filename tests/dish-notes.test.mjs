import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { indexDishNotes, loadDishNotes } from "../lib/taste/dish-notes.mjs";
import { loadDishes } from "../lib/taste/registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = (digit) => `sha256:${digit.repeat(64)}`;
const dishes = [{ id: "dish_a", dishHash: hash("a") }, { id: "dish_b", dishHash: hash("b") }];
const note = (extra = {}) => ({ id: "seen-kitchen", text: "Cooked inside the Kitchen repo.", link: "https://github.com/beejsbj/tasting-kitchen/issues/35", dishes: [{ id: "dish_a", dishHash: hash("a") }], ...extra });
const doc = (...notes) => ({ schemaVersion: 1, notes });

/** The gallery component, compiled the way Vite would, so the test renders the shipped markup. */
async function dishNotesComponent() {
  const source = await readFile(path.join(root, "src/components/DishNotes.tsx"), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const code = outputText.replace(/(["'])react\/jsx-runtime\1/u, JSON.stringify(import.meta.resolve("react/jsx-runtime")));
  return import(`data:text/javascript,${encodeURIComponent(code)}`);
}

test("dish notes pin an exact Dish hash and stay public-safe", () => {
  const indexed = indexDishNotes(doc(note(), note({ id: "second", dishes: [{ id: "dish_a", dishHash: hash("a") }, { id: "dish_b", dishHash: hash("b") }] })), dishes);
  assert.deepEqual(indexed.get("dish_a").map((item) => item.id), ["seen-kitchen", "second"]);
  assert.deepEqual(indexed.get("dish_b"), [{ id: "second", text: "Cooked inside the Kitchen repo.", link: "https://github.com/beejsbj/tasting-kitchen/issues/35" }]);
  assert.throws(() => indexDishNotes(doc(note({ dishes: [{ id: "dish_c", dishHash: hash("c") }] })), dishes), /unknown Dish dish_c/);
  assert.throws(() => indexDishNotes(doc(note({ dishes: [{ id: "dish_a", dishHash: hash("b") }] })), dishes), /immutable hash/);
  assert.throws(() => indexDishNotes(doc(note({ text: "Ran in /home/someone/kitchen" })), dishes), /Public artifact scan failed/);
  assert.throws(() => indexDishNotes(doc(note({ link: "https://example.com/elsewhere" })), dishes), /issue URL/);
  assert.throws(() => indexDishNotes(doc(note(), note()), dishes), /duplicate note id/);
  assert.throws(() => indexDishNotes(doc(note({ extra: true })), dishes), /unknown keys/);
  assert.throws(() => indexDishNotes(doc(note({ dishes: [] })), dishes), /at least one Dish/);
});

const COOKED_IN_REPO_BEFORE = "2026-11-09T00:00:00Z";

test("the shipped notes disclose every Codex and Cursor Dish cooked inside the Kitchen repo", async () => {
  const published = await loadDishes(root);
  const notes = await loadDishNotes(root, { dishes: published });
  // Dishes cooked after the move out of the repo carry no such note, so the check is bounded to the historical ones.
  const affected = published.filter((dish) => ["codex-cli", "cursor-agent"].includes(dish.identity.harness) && dish.executedAt < COOKED_IN_REPO_BEFORE);
  assert.ok(affected.length > 0);
  for (const dish of affected) assert.equal(notes.get(dish.id)?.length, 1, dish.id);
  const kitchenAgents = [...notes].filter(([, items]) => items.some((item) => item.id === "codex-saw-kitchen-agents-md")).map(([id]) => id).sort();
  assert.deepEqual(kitchenAgents, [
    "dish_analyze-brain-dump_codex-luna-xhigh_20260911040943677_dd1c687c",
    "dish_challenge-long-journal_codex-luna-xhigh_20260911040908705_d3c28e28",
    "dish_challenge-short-journal_codex-luna-xhigh_20260911040554290_11f29d19",
    "dish_respond-to-long-journal_codex-luna-xhigh_20260911040830869_c23f5932",
    "dish_respond-to-short-journal_codex-luna-xhigh_20260911040530539_3b35bd7b",
    "dish_support-long-journal_codex-luna-xhigh_20260911040850711_99095fa4",
    "dish_support-short-journal_codex-luna-xhigh_20260911040544083_a3f5ef14",
  ]);
  for (const dish of published.filter((item) => !affected.includes(item))) assert.equal(notes.has(dish.id), false, dish.id);
});

test("a Dish's receipt renders its notes with a link to the issue", async () => {
  const { DishNotes, issueLabel } = await dishNotesComponent();
  const html = renderToStaticMarkup(createElement(DishNotes, { dish: { notes: [{ id: "seen", text: "Cooked inside the Kitchen repo; the model may have seen the Kitchen's AGENTS.md.", link: "https://github.com/beejsbj/tasting-kitchen/issues/35" }] } }));
  assert.match(html, /^<p role="note" class="dish-note[^"]*">Cooked inside the Kitchen repo; the model may have seen the Kitchen(?:'|&#x27;)s AGENTS\.md\. <a href="https:\/\/github\.com\/beejsbj\/tasting-kitchen\/issues\/35" target="_blank" rel="noreferrer">#35 ↗<\/a><\/p>$/u);
  assert.equal(renderToStaticMarkup(createElement(DishNotes, { dish: {} })), "");
  assert.equal(issueLabel("https://github.com/beejsbj/tasting-kitchen/issues/35"), "#35");
});
