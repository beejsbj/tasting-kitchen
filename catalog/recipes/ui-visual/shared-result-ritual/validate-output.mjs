import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

async function outputFiles(root) {
  const files = [];
  async function visit(relative = "") {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (!relative && ["fixtures", "validation"].includes(entry.name)) continue;
      const next = path.join(relative, entry.name);
      if (entry.isDirectory() && (relative || entry.name === "assets")) await visit(next);
      else if (entry.isFile() && (relative || entry.name === "index.html" || /\.(?:css|js)$/u.test(entry.name))) files.push(next);
    }
  }
  await visit();
  return files;
}

export async function validateWorkspace(root = ".") {
  const files = await outputFiles(root);
  if (!files.includes("index.html")) throw new Error("Missing index.html");
  for (const relative of files) {
    if ((await stat(path.join(root, relative))).size === 0) throw new Error(`Empty published file: ${relative}`);
    if (/\.(?:js|mjs)$/u.test(relative)) {
      const source = await readFile(path.join(root, relative), "utf8");
      const check = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: source, encoding: "utf8" });
      if (check.status !== 0) throw new Error(`JavaScript syntax failed: ${relative}\n${check.stderr}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await validateWorkspace();
