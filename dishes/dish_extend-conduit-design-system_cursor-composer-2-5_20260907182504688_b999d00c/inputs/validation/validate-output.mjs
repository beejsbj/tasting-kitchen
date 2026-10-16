import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function containedSource(relative) {
  if (typeof relative !== "string" || !relative.startsWith("src/") || relative.includes("\\")) return false;
  const parts = relative.split("/");
  return parts.every((part) => part && part !== "." && part !== "..") && /\.js$/u.test(relative);
}

async function nonempty(root, relative) {
  let info;
  try { info = await stat(path.join(root, relative)); } catch { throw new Error("Missing required output: " + relative); }
  if (!info.isFile() || info.size === 0) throw new Error("Required output is not a nonempty file: " + relative);
}

function validateRecordEntries(entries, key) {
  if (!Array.isArray(entries)) throw new Error("Extension record " + key + " must be an array");
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Extension record " + key + " entries must be objects");
    if (typeof entry.symbol !== "string" || !/^[A-Za-z_$][\w$]*$/u.test(entry.symbol)) throw new Error("Extension record " + key + " has an invalid symbol");
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") throw new Error("Extension record " + key + " has a missing reason");
    if (!containedSource(entry.source)) throw new Error("Extension record " + key + " has an invalid source path");
  }
}

export async function validateWorkspace(root = ".") {
  const required = ["index.html", "styles.css", "styleguide.js", "extension-decisions.json", "src/conduit-tokens.css", "src/conduit-primitives.js", "src/listing-provenance.js"];
  for (const relative of required) await nonempty(root, relative);
  const entry = await readFile(path.join(root, "index.html"), "utf8");
  if (!/styles\.css/u.test(entry) || !/styleguide\.js/u.test(entry)) throw new Error("index.html must reference styles.css and styleguide.js");
  const guide = await readFile(path.join(root, "styleguide.js"), "utf8");
  for (const module of ["./src/conduit-primitives.js", "./src/listing-provenance.js"]) if (!guide.includes(module)) throw new Error("styleguide.js must import " + module);
  let record;
  try { record = JSON.parse(await readFile(path.join(root, "extension-decisions.json"), "utf8")); } catch { throw new Error("extension-decisions.json must contain JSON"); }
  if (!record || typeof record !== "object" || Array.isArray(record) || Object.keys(record).sort().join(",") !== "declined,local,shared") throw new Error("Extension record must contain exactly shared, local, and declined");
  for (const key of ["shared", "local", "declined"]) validateRecordEntries(record[key], key);
  if (record.local.length === 0) throw new Error("Extension record must include a local feature");
  for (const item of [...record.shared, ...record.local, ...record.declined]) await nonempty(root, item.source);
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
    if ((await stat(path.join(root, relative))).size === 0) throw new Error("Empty published file: " + relative);
    if (!/\.js$/u.test(relative)) continue;
    const source = await readFile(path.join(root, relative), "utf8");
    const check = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: source, encoding: "utf8" });
    if (check.status !== 0) throw new Error("JavaScript syntax failed: " + relative + "\n" + check.stderr);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await validateWorkspace();
