import assert from "node:assert/strict";
import { moveAndCascade } from "../src/schedule.mjs";
import { loadState, saveState } from "../src/store.mjs";

const storage = {};
const moved = moveAndCascade([
  { id: "A", start: 9, duration: 1 },
  { id: "B", start: 10, duration: 1 },
  { id: "C", start: 11, duration: 1 }
], "A", 10);
saveState(storage, moved);
assert.deepEqual(loadState(storage), moved);
console.log("persisted cascade passed");
