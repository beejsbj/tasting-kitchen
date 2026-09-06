import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function sourcePath(value) {
  if (typeof value !== "string" || !value.startsWith("src/") || value.includes("\\")) return false;
  return value.split("/").every((part) => part && part !== "." && part !== "..") && /\.(?:js|mjs)$/u.test(value);
}

async function file(root, relative) {
  let info;
  try {
    info = await stat(path.join(root, relative));
  } catch {
    throw new Error(`Missing or empty required output: ${relative}`);
  }
  if (info.isFile() && info.size > 0) return;
  throw new Error(`Missing or empty required output: ${relative}`);
}

export async function validateWorkspace(root = ".") {
  const required = ["index.html", "styleguide.js", "styles.css", "system-decisions.json", "src/components.js", "src/lottery-board.js", "src/contexts.js", "src/tokens.css"];
  for (const relative of required) await file(root, relative);
  const decisions = JSON.parse(await readFile(path.join(root, "system-decisions.json"), "utf8"));
  if (Object.keys(decisions).sort().join(",") !== "keepLocal,promote,prune") throw new Error("Decision manifest must contain exactly promote, prune, and keepLocal");

  for (const key of ["promote", "prune", "keepLocal"]) {
    const decision = decisions[key];
    if (!decision || Object.keys(decision).sort().join(",") !== "reason,source,symbol") throw new Error(`Invalid ${key} decision fields`);
    if (typeof decision.reason !== "string" || decision.reason.trim() === "") throw new Error(`Missing ${key} reason`);
    const noCandidate = decision.symbol === null && decision.source === null;
    if (noCandidate && key === "keepLocal") throw new Error("keepLocal must name a behavior-owning source symbol");
    if (!noCandidate) {
      if (!/^[A-Za-z_$][\w$]*$/u.test(decision.symbol ?? "")) throw new Error(`Invalid ${key} symbol`);
      if (!sourcePath(decision.source)) throw new Error(`Invalid ${key} source path`);
      await file(root, decision.source);
    }
  }

  const files = [];
  async function visit(relative = "") {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory() && (relative || entry.name === "src")) await visit(next);
      else if (entry.isFile() && (relative || required.includes(entry.name) || /\.(?:css|js)$/u.test(entry.name))) files.push(next);
    }
  }
  await visit();
  for (const relative of files) {
    const info = await stat(path.join(root, relative));
    if (info.size === 0) throw new Error(`Empty published file: ${relative}`);
    if (!/\.(?:js|mjs)$/u.test(relative)) continue;
    const source = await readFile(path.join(root, relative), "utf8");
    const check = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: source, encoding: "utf8" });
    if (check.status !== 0) throw new Error(`JavaScript syntax failed: ${relative}\n${check.stderr}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await validateWorkspace();
