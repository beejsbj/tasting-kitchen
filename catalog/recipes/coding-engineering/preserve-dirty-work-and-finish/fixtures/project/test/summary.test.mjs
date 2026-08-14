import assert from "node:assert/strict";
import { summarize } from "../src/summary.mjs";

const result = summarize([
  { title: "Free disk space", status: "completed" },
  { title: "Migrate archive", status: "canceled" },
  { title: "Choose retention period", status: "unresolved" }
]);

assert.deepEqual(result, {
  completed: ["Free disk space"],
  canceled: ["Migrate archive"],
  unresolved: ["Choose retention period"],
  next: "Choose retention period"
});
console.log("summary behavior passed");
