import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REQUIRED = [
  "index.html",
  "styles.css",
  "styleguide.js",
  "extension-notes.json",
  "src/source-provenance.json",
  "src/static-tabs.js",
  "src/mode-samples.js",
  "src/reference/README.md",
  "src/reference/style.css",
  "src/reference/AppHeader.vue",
  "src/reference/OverlayPanelShell.vue",
  "src/reference/IconButton.vue",
  "src/reference/Tabs.vue",
  "src/reference/TabsList.vue",
  "src/reference/TabsTrigger.vue",
  "src/reference/TabsContent.vue",
  "src/reference/solfege.ts"
];

function contained(relative) {
  return typeof relative === "string" && relative.startsWith("src/reference/") && !relative.includes("\\") &&
    relative.split("/").every((part) => part && part !== "." && part !== "..");
}

async function nonempty(root, relative) {
  let info;
  try { info = await stat(path.join(root, relative)); } catch { throw new Error(`Missing required output: ${relative}`); }
  if (!info.isFile() || info.size === 0) throw new Error(`Required output is not a nonempty file: ${relative}`);
}

export async function validateWorkspace(root = ".") {
  for (const relative of REQUIRED) await nonempty(root, relative);

  const provenance = JSON.parse(await readFile(path.join(root, "src/source-provenance.json"), "utf8"));
  if (!provenance.upstream || provenance.upstream.repository !== "https://github.com/beejsbj/emotitone-solfrege" ||
      provenance.upstream.commit !== "4cb0fdc513c60f0affd7e3cf3a1302a78af082ab") {
    throw new Error("Source provenance must retain the pinned Emotitone repository and commit");
  }
  if (!Array.isArray(provenance.files) || provenance.files.length < 9) throw new Error("Source provenance must list the bounded reference files");
  for (const entry of provenance.files) {
    if (!entry || !contained(entry.path) || typeof entry.upstreamPath !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? "")) {
      throw new Error("Invalid source provenance entry");
    }
    const bytes = await readFile(path.join(root, entry.path));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== entry.sha256) throw new Error(`Reference digest mismatch: ${entry.path}`);
  }

  const notes = JSON.parse(await readFile(path.join(root, "extension-notes.json"), "utf8"));
  if (Object.keys(notes).sort().join(",") !== "featureBoundary,sharedModule,staticBoundary") {
    throw new Error("Extension notes must contain exactly sharedModule, featureBoundary, and staticBoundary");
  }
  for (const key of Object.keys(notes)) {
    if (typeof notes[key] !== "string" || notes[key].trim() === "") throw new Error(`Missing ${key} note`);
  }

  const guide = await readFile(path.join(root, "styleguide.js"), "utf8");
  for (const [specifier, pattern] of [
    ["./src/static-tabs.js", /(?:from\s*["\x27]\.\/src\/static-tabs\.js["\x27]|import\s*["\x27]\.\/src\/static-tabs\.js["\x27])/u],
    ["./src/mode-samples.js", /(?:from\s*["\x27]\.\/src\/mode-samples\.js["\x27]|import\s*["\x27]\.\/src\/mode-samples\.js["\x27])/u]
  ]) {
    if (!pattern.test(guide)) throw new Error(`Styleguide must import ${specifier}`);
  }

  const files = [];
  async function visit(relative = "") {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory() && (relative || entry.name === "src")) await visit(next);
      else if (entry.isFile() && (relative || REQUIRED.includes(entry.name) || /\.(?:css|js)$/u.test(entry.name))) files.push(next);
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
