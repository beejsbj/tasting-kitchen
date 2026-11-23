#!/usr/bin/env node
// Rebuild the music room's vendored Strudel engine from the exact npm tarballs
// its manifest pins. The outputs are committed, so nothing is fetched at cook time.
// usage: node scripts/vendor-music-room.mjs            rebuild (needs the network and tar)
//        node scripts/vendor-music-room.mjs --check    compare the committed outputs with the manifest, offline
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const upstream = path.join(root, "catalog/recipes/music-creative-code/play-a-short-set/fixtures/upstream/strudel");
const manifestFile = path.join(upstream, "manifest.json");
const OUTPUTS = ["strudel.mjs", "superdough.js", "worklets.js"];
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");

const manifest = JSON.parse(await readFile(manifestFile, "utf8"));

if (process.argv.includes("--check")) {
  let stale = 0;
  for (const name of OUTPUTS) {
    const bytes = await readFile(path.join(upstream, name));
    const pinned = manifest.outputs?.[name];
    if (!pinned || pinned.sha256 !== digest("sha256", bytes) || pinned.bytes !== bytes.length) { console.error(`stale: ${name}`); stale += 1; }
  }
  process.exit(stale ? 1 : 0);
}

const work = await realpath(await mkdtemp(path.join(os.tmpdir(), "music-room-vendor-")));
try {
  // One download per package version, verified against the pinned sha512 before it is unpacked.
  const tarballs = new Map();
  for (const item of manifest.packages) {
    const key = `${item.name}@${item.version}`;
    if (!tarballs.has(key)) {
      const url = `${manifest.registry}/${item.name}/-/${item.name.split("/").pop()}-${item.version}.tgz`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${key}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (digest("sha512", bytes) !== item.sha512) throw new Error(`${key}: sha512 does not match the pin`);
      const file = path.join(work, `${digest("sha256", key).slice(0, 16)}.tgz`);
      await writeFile(file, bytes);
      tarballs.set(key, file);
    }
    const target = path.join(work, item.path);
    await mkdir(target, { recursive: true });
    execFileSync("tar", ["-xzf", tarballs.get(key), "--strip-components=1", "-C", target]);
  }

  const versions = Object.fromEntries(manifest.packages.filter((item) => !item.path.includes("/node_modules/", "node_modules/".length)).map((item) => [item.name, item.version]));
  const banner = (what) => [
    "/*",
    ` * ${what}`,
    ` * Built for the Tasting Kitchen music room from the npm packages pinned in manifest.json, unminified.`,
    ` * Licence: ${manifest.license} (see LICENSE). Other notices: THIRD-PARTY-NOTICES.md.`,
    ` * Upstream source: ${manifest.repository}`,
    ...manifest.modifications.map((line) => ` * Modified: ${line}`),
    " */",
  ].join("\n");

  await writeFile(path.join(work, "engine-entry.mjs"), [
    'import * as core from "@strudel/core";',
    'import * as mini from "@strudel/mini";',
    'import * as tonal from "@strudel/tonal";',
    'import { transpiler } from "@strudel/transpiler";',
    "export { core, mini, tonal, transpiler };",
    "",
  ].join("\n"));
  await writeFile(path.join(work, "audio-entry.mjs"), 'export { superdough, initAudio, registerSynthSounds, getAudioContext, getSuperdoughAudioController } from "superdough";\n');

  // Build from each package's own source modules, so the bundle stays readable.
  const source = (name) => ({ find: new RegExp(`^${name}$`, "u"), replacement: path.join(work, "node_modules", name, "index.mjs") });
  const roomPlugin = {
    name: "music-room",
    enforce: "pre",
    resolveId(id) { if (id.endsWith("?audioworklet")) return "\0room-worklet-url"; },
    load(id) {
      // superdough inlines its worklets as a data: URL. A Dish is served under a policy that
      // refuses those, so the player loads the same worklets from a file beside the page.
      if (id === "\0room-worklet-url") return 'export default new URL("worklets.js", document.baseURI).href;';
      // The shared-worker scheduler is never used by the room; without it the engine is one file.
      if (id.split(path.sep).join("/").endsWith("@strudel/core/neocyclist.mjs")) return 'export class NeoCyclist { constructor() { throw new Error("NeoCyclist is not part of the music room engine"); } }';
    },
  };
  const { build } = await import("vite");
  // The bundler names each module by its path from the working directory.
  process.chdir(work);
  const bundle = (entry, format, name, fileName, what) => build({
    root: work,
    configFile: false,
    logLevel: "warn",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: { alias: ["@strudel/core", "@strudel/mini", "@strudel/tonal", "@strudel/transpiler", "superdough"].map(source) },
    plugins: [roomPlugin],
    build: {
      outDir: "out",
      emptyOutDir: false,
      minify: false,
      target: "es2022",
      lib: { entry, formats: [format], ...(name ? { name } : {}), fileName: () => fileName },
      rolldownOptions: { output: { banner: banner(what) } },
    },
  });
  await bundle("engine-entry.mjs", "es", null, "strudel.mjs", `Strudel pattern engine: @strudel/core ${versions["@strudel/core"]}, @strudel/mini ${versions["@strudel/mini"]}, @strudel/tonal ${versions["@strudel/tonal"]}, @strudel/transpiler ${versions["@strudel/transpiler"]} and their dependencies.`);
  await bundle("audio-entry.mjs", "iife", "RoomAudio", "superdough.js", `superdough ${versions.superdough}, Strudel's Web Audio synth, and its dependencies.`);
  await bundle(path.join(work, "node_modules/superdough/worklets.mjs"), "iife", "RoomWorklets", "worklets.js", `The AudioWorklet processors of superdough ${versions.superdough}.`);

  const outputs = {};
  // The whole dependency tree is installed so every import resolves; only some of it ends up in the bundles.
  const bundled = new Set();
  for (const name of OUTPUTS) {
    const bytes = await readFile(path.join(work, "out", name));
    if (bytes.includes(work)) throw new Error(`${name} carries the build directory`);
    for (const [, modulePath] of bytes.toString("utf8").matchAll(/^\s*\/\/#region (node_modules\/\S+)$/gmu)) {
      bundled.add(manifest.packages.map((item) => item.path).filter((candidate) => modulePath.startsWith(`${candidate}/`)).sort((a, b) => b.length - a.length)[0]);
    }
    await writeFile(path.join(upstream, name), bytes);
    outputs[name] = { sha256: digest("sha256", bytes), bytes: bytes.length };
  }
  const stray = (await readdir(path.join(work, "out"))).filter((name) => !OUTPUTS.includes(name));
  if (stray.length) throw new Error(`unexpected build outputs: ${stray.join(", ")}`);

  // The licence each bundled package ships, grouped by identical text.
  const agpl = await readFile(path.join(work, "node_modules/@strudel/core/LICENSE"), "utf8");
  const byText = new Map();
  const packages = manifest.packages.map((item) => ({ path: item.path, name: item.name, version: item.version, license: item.license, sha512: item.sha512, bundled: bundled.has(item.path) }));
  for (const item of packages.filter((candidate) => candidate.bundled)) {
    const directory = path.join(work, item.path);
    const file = (await readdir(directory)).find((name) => /^licen[cs]e(?:\.[a-z]+)?$/iu.test(name));
    let text = file ? (await readFile(path.join(directory, file), "utf8")).replace(/\r\n/gu, "\n").trim() : null;
    if (text === agpl.trim()) text = `${manifest.license}: the full text is in LICENSE.`;
    if (!text) {
      const author = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")).author;
      text = `${item.license}. The package ships no licence file; its package.json names the author as ${typeof author === "string" ? author : author?.name ?? "unstated"}.`;
    }
    const label = `${item.name} ${item.version} (${item.license})`;
    byText.set(text, [...new Set([...(byText.get(text) ?? []), label])]);
  }
  const notices = ["# Third-party notices", "", "The packages bundled into strudel.mjs, superdough.js and worklets.js, with the licence text each one ships. Generated by scripts/vendor-music-room.mjs.", ""];
  for (const [text, labels] of byText) notices.push(`## ${labels.sort().join(", ")}`, "", "```text", text, "```", "");
  await writeFile(path.join(upstream, "THIRD-PARTY-NOTICES.md"), notices.join("\n"));
  await writeFile(path.join(upstream, "LICENSE"), agpl);

  const vite = JSON.parse(await readFile(path.join(root, "node_modules/vite/package.json"), "utf8")).version;
  await writeFile(manifestFile, `${JSON.stringify({ ...manifest, builtWith: { vite }, outputs, packages }, null, 2)}\n`);
  for (const name of OUTPUTS) console.log(`${name}  ${outputs[name].bytes} bytes  sha256 ${outputs[name].sha256}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
