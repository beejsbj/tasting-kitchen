import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function containedSource(relative) {
  if (typeof relative !== "string" || !relative.startsWith("src/") || relative.includes("\\")) return false;
  const parts = relative.split("/");
  return parts.every((part) => part && part !== "." && part !== "..") && /\.(?:js|mjs)$/u.test(relative);
}

export async function validateWorkspace(root = ".") {
  const requiredFiles = ["index.html", "styleguide.js", "styles.css", "system-decisions.json", "src/components.js", "src/signal-panel.js", "src/tokens.css"];
  for (const relative of requiredFiles) {
    let info;
    try { info = await stat(path.join(root, relative)); } catch { throw new Error(`Missing required output: ${relative}`); }
    if (!info.isFile() || info.size === 0) throw new Error(`Required output is not a nonempty file: ${relative}`);
  }
  const decisions = JSON.parse(await readFile(path.join(root, "system-decisions.json"), "utf8"));
  if (Object.keys(decisions).sort().join(",") !== "keepLocal,promote,prune") throw new Error("Decision manifest must contain exactly promote, prune, and keepLocal");
  const symbols = [];
  for (const key of ["promote", "prune", "keepLocal"]) {
    const decision = decisions[key];
    if (!decision || Object.keys(decision).sort().join(",") !== "reason,source,symbol") throw new Error(`Invalid ${key} decision fields`);
    if (!/^[A-Za-z_$][\w$]*$/u.test(decision.symbol ?? "")) throw new Error(`Invalid ${key} symbol`);
    if (typeof decision.reason !== "string" || decision.reason.trim() === "") throw new Error(`Missing ${key} reason`);
    if (!containedSource(decision.source)) throw new Error(`Invalid ${key} source path`);
    let sourceInfo;
    try { sourceInfo = await stat(path.join(root, decision.source)); } catch { throw new Error(`Missing ${key} source file`); }
    if (!sourceInfo.isFile() || sourceInfo.size === 0) throw new Error(`Empty ${key} source file`);
    symbols.push(decision.symbol);
  }
  if (new Set(symbols).size !== 3) throw new Error("Decision symbols must be distinct");

  // Match the published include paths, including nested source modules.
  const files = [];
  async function visit(relative = "") {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory() && (relative || entry.name === "src")) await visit(next);
      else if (entry.isFile() && (relative || requiredFiles.includes(entry.name) || /\.(?:css|js)$/u.test(entry.name))) files.push(next);
    }
  }
  await visit();
  for (const relative of files) {
    if ((await stat(path.join(root, relative))).size === 0) throw new Error(`Empty published file: ${relative}`);
    if (!/\.(?:js|mjs)$/u.test(relative)) continue;
    const source = await readFile(path.join(root, relative), "utf8");
    const check = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: source, encoding: "utf8" });
    if (check.status !== 0) throw new Error(`JavaScript syntax failed: ${relative}\n${check.stderr}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await validateWorkspace();
