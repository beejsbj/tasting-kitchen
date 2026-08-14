import assert from "node:assert/strict";
import * as policy from "../src/policy.mjs";

assert.deepEqual(Object.keys(policy), ["selectDelivery"]);
for (const zone of ["local", "remote"]) {
  assert.deepEqual(policy.selectDelivery({ zone, fragile: true, weight: 40, rush: true }), { method: "courier", message: "Fragile order requires courier" });
  assert.deepEqual(policy.selectDelivery({ zone, fragile: false, weight: 40, rush: true }), { method: "freight", message: "Heavy order requires freight" });
  assert.deepEqual(policy.selectDelivery({ zone, fragile: false, weight: 2, rush: true }), { method: "express", message: "Rush order uses express" });
  assert.deepEqual(policy.selectDelivery({ zone, fragile: false, weight: 2, rush: false }), { method: "standard", message: "Standard delivery" });
}
console.log("policy contract passed");
