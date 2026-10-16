import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** A Menu is a plain list of recipe ids. Coverage is measured against the current recipes and their current hashes. */
export async function loadMenus(repoRoot) {
  const root = path.join(repoRoot, "catalog", "menus");
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(async (entry) => JSON.parse(await readFile(path.join(root, entry.name), "utf8"))));
}
