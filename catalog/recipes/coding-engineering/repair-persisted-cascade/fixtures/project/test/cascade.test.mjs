import assert from "node:assert/strict";
import { moveAndCascade } from "../src/schedule.mjs";

const initial = [
  { id: "A", start: 9, duration: 1 },
  { id: "B", start: 10, duration: 1 },
  { id: "C", start: 11, duration: 1 }
];
const moved = moveAndCascade(initial, "A", 10);
assert.deepEqual(moved.map(({ id, start }) => ({ id, start })), [
  { id: "A", start: 10 },
  { id: "B", start: 11 },
  { id: "C", start: 12 }
]);
console.log("in-memory cascade passed");
