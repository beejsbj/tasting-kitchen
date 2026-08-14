import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { healthResponse } from "../src/health.mjs";

const config = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8"));
assert.deepEqual(healthResponse(config, config.publicPath), { status: 200, body: "ok" });
console.log("unit test passed");
