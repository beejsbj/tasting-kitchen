import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { publicTextFindings, scanPublicTree, scanWebArtifactNetwork } from "../lib/taste/files.mjs";

test("public scan distinguishes serialized page newlines from Windows absolute paths", () => {
  const serialized = JSON.stringify({ response: "Finished the page:\nNext line includes more prose." }, null, 2);
  assert.deepEqual(publicTextFindings(serialized), []);
  assert.ok(publicTextFindings("C:\\Users\\name\\file").includes("absolute Windows path"));
  assert.ok(publicTextFindings("C:/Users/name/file").includes("absolute Windows path"));
});

test("public scan distinguishes JavaScript regex literals from Unix absolute paths", () => {
  assert.deepEqual(publicTextFindings("nextState.replace(/-/g, ' ')"), []);
  assert.deepEqual(publicTextFindings("value.match(/state/i)"), []);
  assert.ok(publicTextFindings("Read /etc/g before continuing").includes("absolute path"));
  assert.ok(publicTextFindings("Inspect /.ssh/id before continuing").includes("absolute path"));
  assert.ok(publicTextFindings("The token /state/i appears in prose").includes("absolute path"));
  assert.ok(publicTextFindings("replace(/etc/g) is text, not an instance method call").includes("absolute path"));
  assert.ok(publicTextFindings("Read /var/log/model-tasting.log before continuing").includes("absolute path"));
  assert.ok(publicTextFindings("Open /workspace/output/index.html").includes("absolute path"));
});

test("public scan permits quoted source-root aliases without permitting absolute paths", () => {
  assert.deepEqual(publicTextFindings('import type { Note } from "@/types/music";'), []);
  assert.deepEqual(publicTextFindings('src: url("@/assets/fonts/local.woff2")'), []);
  assert.ok(publicTextFindings('import data from "/workspace/output/data.js";').includes("absolute path"));
  assert.ok(publicTextFindings('src: url("/home/user/private.woff2")').includes("absolute home path"));
});

test("public tree scan permits only parent references that resolve inside the artifact", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-public-tree-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "source"));
  await writeFile(path.join(root, "logic.mjs"), "export const ready = true;\n");
  await writeFile(path.join(root, "source/inside.mjs"), 'import { ready } from "../logic.mjs";\n');

  await assert.doesNotReject(scanPublicTree(root));

  await writeFile(path.join(root, "source/outside.mjs"), 'import "../../outside.mjs";\n');
  await assert.rejects(scanPublicTree(root), /path traversal/);
});

test("public tree scan permits a source import of Kitchen equipment the artifact does not ship", async (t) => {
  // A lyric scene in source/scenes/ imports the engine it ran against as ../engine/scene;
  // the engine is Kitchen's and is deliberately not in the delivery.
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-public-tree-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "source/scenes"), { recursive: true });
  await writeFile(path.join(root, "source/scenes/words.ts"), "import { Scene } from '../engine/scene';\nimport { W } from \"../engine/gl\";\n");
  await assert.doesNotReject(scanPublicTree(root));
  await writeFile(path.join(root, "source/scenes/escape.ts"), "import x from '../../../engine/scene';\n");
  await assert.rejects(scanPublicTree(root), /path traversal/);
});

test("public scan permits a first-line env shebang and nothing else of its shape", () => {
  assert.deepEqual(publicTextFindings("#!/usr/bin/env node\nconsole.log(1);\n"), []);
  assert.deepEqual(publicTextFindings("#!/usr/bin/env -S node --no-warnings\n"), []);
  assert.ok(publicTextFindings("#!/home/user/bin/node\n").includes("absolute home path"));
  assert.ok(publicTextFindings("#!/opt/tools/node\n").includes("absolute path"));
  assert.ok(publicTextFindings("// run #!/usr/bin/env node\n/usr/bin/env node x\n").includes("absolute path"));
});

test("verbatim inputs relax path shapes, including regexes shaped like Windows paths, but not leaks", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-verbatim-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "inputs/validation"), { recursive: true });
  const film = "const integrated = ebur.stderr.match(/I:\\s+(-?[\\d.]+) LUFS/)?.[1];\n";
  assert.ok(publicTextFindings(film).includes("absolute Windows path"));
  await writeFile(path.join(root, "inputs/validation/film.mjs"), film);
  await assert.doesNotReject(scanPublicTree(root, { verbatim: ["inputs"] }));
  await assert.rejects(scanPublicTree(root), /absolute Windows path/);
  await writeFile(path.join(root, "inputs/validation/film.mjs"), `${film}// access_token = example\n`);
  await assert.rejects(scanPublicTree(root, { verbatim: ["inputs"] }), /authentication-token field/);
});

test("verbatim inputs are scanned by content, whatever their extension; binary bytes are left alone", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-verbatim-ext-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "inputs/src"), { recursive: true });
  await writeFile(path.join(root, "inputs/src/Card.vue"), "<template><div/></template>\n");
  await writeFile(path.join(root, "inputs/src/image.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0xfe, 0x73, 0x6b, 0x2d]));
  await writeFile(path.join(root, "inputs/src/latin1.dat"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  await assert.doesNotReject(scanPublicTree(root, { verbatim: ["inputs"] }));
  for (const name of ["Card.vue", "NOTES", "build.log"]) {
    const file = path.join(root, "inputs/src", name);
    await writeFile(file, "const key = 'sk-proj1234567890abcdefghij';\n");
    await assert.rejects(scanPublicTree(root, { verbatim: ["inputs"] }), /credential-like token/, name);
    await rm(file);
  }
});

test("private machine paths are caught with or without a trailing segment", () => {
  for (const text of ["cd /home/admin", "see /Users/burooj", "open /root/.config/app", "under /mnt/server-ssd/BJsWorkspace/Brain", "mounted at /mnt/server-ssd"]) {
    assert.ok(publicTextFindings(text).includes("absolute home path"), text);
  }
  for (const text of ["Keep camera/root/drawing exposure decisions explicit.", "route `/style-guide/components/`"]) {
    assert.equal(publicTextFindings(text).includes("absolute home path"), false, text);
  }
});

test("web artifact scan rejects remote runtime dependencies", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-web-scan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "index.html"), '<script src="https://cdn.example.test/ui.js"></script>');
  await assert.rejects(scanWebArtifactNetwork(root), /remote runtime references/);
  await writeFile(path.join(root, "index.html"), "<main>Self-contained</main>");
  await scanWebArtifactNetwork(root);
  await writeFile(path.join(root, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
  await scanWebArtifactNetwork(root);
  await writeFile(path.join(root, "style.css"), '@import url("//cdn.example.test/type.css");');
  await assert.rejects(scanWebArtifactNetwork(root), /remote runtime references/);
  assert.ok(true);
});
