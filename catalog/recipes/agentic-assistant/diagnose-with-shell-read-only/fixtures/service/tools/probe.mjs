import { readFile } from "node:fs/promises";
import { healthResponse } from "../src/health.mjs";

const config = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8"));
const result = healthResponse(config, "/health");
console.log(JSON.stringify({ requestPath: "/health", ...result }));
if (result.status !== 200) process.exitCode = 1;
