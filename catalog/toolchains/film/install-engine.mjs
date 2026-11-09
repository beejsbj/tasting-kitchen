#!/usr/bin/env node
// Build step of the film toolchain image: assemble the pinned, patched lyric
// engine from toolchain.json and refuse any byte that does not match its pin.
// usage: node install-engine.mjs <toolchain.json> <skill files dir> <brand overlay> <destination>
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const [toolchainFile, skillDir, brandOverlay, destination] = process.argv.slice(2);
if (!destination) throw new Error("usage: install-engine.mjs <toolchain.json> <skill files dir> <brand overlay> <destination>");
const engine = JSON.parse(readFileSync(toolchainFile, "utf8")).lyricEngine;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (argv, cwd) => execFileSync(argv[0], argv.slice(1), { cwd, stdio: ["ignore", "inherit", "inherit"] });
const expect = (label, bytes, wanted) => {
  const actual = sha256(bytes);
  if (actual !== wanted) throw new Error(`${label}: sha256 ${actual} does not match pin ${wanted}`);
};

run(["git", "clone", "--quiet", engine.repository, destination]);
run(["git", "checkout", "--quiet", "--detach", engine.commit], destination);
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: destination, encoding: "utf8" }).trim();
if (head !== engine.commit) throw new Error(`engine HEAD ${head} is not the pinned ${engine.commit}`);

// The patch is the skill's own bytes; a moved skill pin or an edited patch fails here.
const patchFile = path.join(skillDir, engine.patch.path);
expect("engine.patch", readFileSync(patchFile), engine.patch.sha256);
run(["git", "apply", patchFile], destination);

// The patched main.ts imports lib/brand.ts. Kitchen's overlay is the skill's file with empty handles.
expect("skill brand.ts", readFileSync(path.join(skillDir, engine.brand.path)), engine.brand.sha256);
mkdirSync(path.join(destination, "app/src/lib"), { recursive: true });
copyFileSync(brandOverlay, path.join(destination, "app/src/lib/brand.ts"));

const fonts = path.join(destination, "app/public/fonts");
for (const font of engine.fonts.files) {
  const url = `${engine.fonts.repository.replace("github.com", "raw.githubusercontent.com")}/${engine.fonts.commit}/${font.source}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font ${font.source}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(`font ${font.source}`, bytes, font.sha256);
  mkdirSync(path.dirname(path.join(fonts, font.as)), { recursive: true });
  writeFileSync(path.join(fonts, font.as), bytes);
}
const pop = path.join(skillDir, "assets/fonts/pop");
mkdirSync(path.join(fonts, "pop"), { recursive: true });
for (const name of readdirSync(pop).filter((file) => file.endsWith(".ttf")).sort()) copyFileSync(path.join(pop, name), path.join(fonts, "pop", name));

run(["bun", "install", "--frozen-lockfile"], path.join(destination, "app"));
run(["bun", "pm", "cache", "rm"], path.join(destination, "app"));
// The engine is supplied as plain files; its provenance is engine.json, not a Git history.
rmSync(path.join(destination, ".git"), { recursive: true, force: true });

// Record what was assembled. Kitchen hashes the engine tree itself when it mounts it.
writeFileSync(path.join(destination, "..", "engine.json"), `${JSON.stringify({
  repository: engine.repository,
  commit: head,
  patchSha256: engine.patch.sha256,
  brandSha256: sha256(readFileSync(brandOverlay)),
  fontsCommit: engine.fonts.commit,
}, null, 2)}\n`);
