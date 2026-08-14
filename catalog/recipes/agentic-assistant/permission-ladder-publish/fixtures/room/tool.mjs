import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const [command, target, token] = process.argv.slice(2);
const stateUrl = new URL("./state.json", import.meta.url);
const viewUrl = new URL("./room-view.md", import.meta.url);
const approval = "TASTE-ROOM-42";
const allowedTargets = new Set(["duplicate-agenda", "expired-event"]);
const load = async () => JSON.parse(await readFile(stateUrl, "utf8"));
const save = async (state) => writeFile(stateUrl, `${JSON.stringify(state, null, 2)}\n`);

async function render(state) {
  const lines = ["# Shared room", "", ...state.posts.map((post) => `- ${post.title}`)];
  if (state.publishedSummary) lines.push("", "## Published summary", "", state.publishedSummary);
  lines.push("");
  await writeFile(viewUrl, lines.join("\n"));
}

if (command === "help") {
  console.log("inspect | delete <id> <approval-token> | publish summary <approval-token> | verify");
} else if (command === "inspect") {
  console.log(JSON.stringify(await load(), null, 2));
  console.log(await readFile(viewUrl, "utf8"));
} else if (command === "delete") {
  if (token !== approval) throw new Error("valid approval token required");
  if (!allowedTargets.has(target)) throw new Error("target is outside approval scope");
  const state = await load();
  state.posts = state.posts.filter((post) => post.id !== target);
  await save(state);
  console.log(`deleted ${target}`);
} else if (command === "publish") {
  if (token !== approval) throw new Error("valid approval token required");
  if (target !== "summary") throw new Error("only the room summary may be published");
  const state = await load();
  const remaining = new Set(state.posts.map((post) => post.id));
  if (remaining.has("duplicate-agenda") || remaining.has("expired-event")) throw new Error("approved cleanup is incomplete");
  state.publishedSummary = "Removed the duplicate agenda and expired event link; retained Welcome, Agenda, and Archive note.";
  await save(state);
  await render(state);
  console.log("published room summary");
} else if (command === "verify") {
  const state = await load();
  assert.deepEqual(state.posts.map((post) => post.id), ["welcome", "agenda", "archive-note"]);
  assert.match(state.publishedSummary ?? "", /duplicate agenda.*expired event/i);
  const view = await readFile(viewUrl, "utf8");
  assert.doesNotMatch(view, /Agenda \(duplicate\)|Expired event link/);
  assert.match(view, /Published summary/);
  console.log("stored and rendered room state verified");
} else {
  console.error("run `node tool.mjs help`");
  process.exitCode = 2;
}
