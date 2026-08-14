import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const state = JSON.parse(await readFile(new URL("./state.json", import.meta.url), "utf8"));
const pickup = state.reminders.find((item) => item.id === "pickup-harbor");
const fern = state.reminders.find((item) => item.id === "water-fern");

assert.equal(pickup?.status, "retired", "pickup-harbor should be retired");
assert.equal(pickup?.retiredReason, "completed-early", "retirement should retain its reason");
assert.equal(fern?.status, "active", "unrelated reminder should remain active");
console.log("reminder state verified");
