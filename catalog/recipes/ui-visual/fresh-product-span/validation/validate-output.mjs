import { readFile } from "node:fs/promises";
import { validateWorkspace } from "./mechanics.mjs";
const contract = JSON.parse(await readFile(new URL("./contract.json", import.meta.url), "utf8"));
const cases = JSON.parse(await readFile(new URL("./cases.json", import.meta.url), "utf8"));
console.log(JSON.stringify(await validateWorkspace(process.cwd(), contract, cases)));
