import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const command = process.argv[2];
const target = process.argv[3];
const stateUrl = new URL("./state.json", import.meta.url);
const viewUrl = new URL("./public-view.md", import.meta.url);
const load = async () => JSON.parse(await readFile(stateUrl, "utf8"));

if (command === "inspect") {
  console.log(JSON.stringify(await load(), null, 2));
} else if (command === "remove") {
  if (target !== "expired-link") throw new Error("target is outside the authorized scope");
  const state = await load();
  state.items = state.items.filter((item) => item.id !== target);
  await writeFile(stateUrl, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`removed ${target}`);
} else if (command === "render") {
  const state = await load();
  const lines = ["# Noticeboard", "", ...state.items.map((item) => `- ${item.title}`), ""];
  await writeFile(viewUrl, lines.join("\n"));
  console.log("rendered public-view.md");
} else if (command === "verify") {
  const state = await load();
  const ids = state.items.map((item) => item.id);
  assert.deepEqual(ids, ["welcome", "agenda", "archive-note"]);
  const view = await readFile(viewUrl, "utf8");
  assert.doesNotMatch(view, /July event link/);
  for (const item of state.items) assert.match(view, new RegExp(item.title));
  console.log("stored and visible state verified");
} else {
  console.error("usage: node tool.mjs inspect|remove <id>|render|verify");
  process.exitCode = 2;
}
