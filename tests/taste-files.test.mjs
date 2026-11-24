import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { publicTextFindings, scanPublicTree, scanWebArtifactNetwork, selectArtifactFiles } from "../lib/taste/files.mjs";

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

test("an absolute path after a colon is still an absolute path; URLs and colon-joined references are not", () => {
  // A colon is not a path boundary: a PATH list, an scp-style target, a label or a one-slash URI still names the machine.
  for (const text of ["see:/etc/hosts", "PATH=/a/bin:/opt/private-tools/bin", "host:/srv/data/notes.txt", "file:/etc/hosts", "jar:file:/opt/app/lib.jar", "notes.txt:/var/tmp/other/secret.txt"]) {
    assert.ok(publicTextFindings(text).includes("absolute path"), text);
  }
  // A URL's path follows `//host`, which the rule already skips; a file:line reference, a time and a module specifier have no rooted path.
  for (const text of [
    "See https://example.com/docs/guide/intro.html.",
    "http://localhost:5173/dishes/demo/index.html",
    "<svg xmlns='http://www.w3.org/2000/svg'>",
    "wss://example.com/socket/v1 and s3://bucket/key/part",
    "git@github.com:owner/repo.git",
    "lib/taste/files.mjs:12:4 and src/app.ts:30",
    "at 12:30 and 2026-11-13T12:00:00.000Z",
    'import { readFile } from "node:fs/promises";',
    "data:image/svg+xml;utf8,<svg/>",
  ]) {
    assert.deepEqual(publicTextFindings(text), [], text);
  }
  // A Windows drive path was already refused as one; it stays refused.
  assert.ok(publicTextFindings("C:/Windows/Fonts/arial.ttf").includes("absolute Windows path"));
});

test("a rooted path after a flag or a bare dash or underscore is still an absolute path; hyphenated relative names are not (#113)", () => {
  // A compiler or linker flag, or a bare `-`/`_` that starts a token, does not make the path after it relative.
  for (const text of [
    "-I/usr/include/foo",
    "cc -L/opt/lib/x main.c",
    "ld --sysroot/opt/cross/root",
    '"-L/opt/private-tools/lib"',
    "(-I/srv/headers/include)",
    "_/etc/hosts",
    "-/etc/hosts",
    "list:\n-/etc/hosts",
    "--/var/tmp/x",
    "-Wl,-rpath,-L/opt/lib/x",
  ]) {
    assert.ok(publicTextFindings(text).includes("absolute path"), text);
  }
  // A hyphen, underscore or dot inside a name still continues a relative path.
  for (const text of [
    "my-dir/sub/file",
    "src/my_module/sub/file.ts",
    "./assets/img/logo.svg",
    ".github/workflows/ci.yml",
    "node_modules/.bin/vite",
    "re-run/rebuild/restart are verbs",
    "foo_/bar/baz",
    "__dirname/x",
    "https://gitlab.com/group/project/-/blob/main/README.md",
    "Compare 2026-11/12/13 and v1.2-3/4",
    "path-to/my-dir/file-name.md",
    "nextState.replace(/-/g, ' ')",
    "value.replace(/_/g, '-')",
    // Blank form fields, a one-letter flag glued to a relative path, suffixes in prose.
    "Date: __/__/____",
    '<input placeholder="--/--/----">',
    "CFLAGS = -Isrc/include/foo -Llib/x/y",
    "Words ending in -ish/-esque/-y are informal.",
  ]) {
    assert.deepEqual(publicTextFindings(text), [], text);
  }
});

test("the absolute-path rule stays linear on long word runs", () => {
  // A lookbehind that rescans a whole run at every position is quadratic: a 200 kB hex blob took minutes.
  for (const text of ["a".repeat(200_000), `-${"a".repeat(200_000)}/x/y`, "-".repeat(200_000), `${"0123456789abcdef".repeat(12_500)}/`]) {
    const started = performance.now();
    publicTextFindings(text);
    assert.ok(performance.now() - started < 2000, `${text.slice(0, 12)}… took ${Math.round(performance.now() - started)} ms`);
  }
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
  // A host location spelled after a climb that stays inside the tree is not hidden by the mask.
  await rm(path.join(root, "source/scenes/escape.ts"));
  for (const specifier of ["../../mnt/server-ssd/work/notes", "../../root/.config/env", "../x/home/user/file", "../../private/fixtures/a"]) {
    await writeFile(path.join(root, "source/scenes/disguised.ts"), `import x from "${specifier}";\n`);
    await assert.rejects(scanPublicTree(root), /path traversal/, specifier);
  }
});

test("public scan permits a first-line env shebang and nothing else of its shape", () => {
  assert.deepEqual(publicTextFindings("#!/usr/bin/env node\nconsole.log(1);\n"), []);
  assert.deepEqual(publicTextFindings("#!/usr/bin/env -S node --no-warnings\n"), []);
  assert.ok(publicTextFindings("#!/home/user/bin/node\n").includes("absolute home path"));
  assert.ok(publicTextFindings("#!/opt/tools/node\n").includes("absolute path"));
  assert.ok(publicTextFindings("// run #!/usr/bin/env node\n/usr/bin/env node x\n").includes("absolute path"));
  // Only an interpreter and its flags are exempt; anything else on the line is scanned.
  assert.ok(publicTextFindings("#!/usr/bin/env node /home/admin/.config\n").includes("absolute home path"));
  assert.ok(publicTextFindings("#!/usr/bin/env node sk-proj1234567890abcdefghij\n").includes("credential-like token"));
  // Flag values and the interpreter slot are scanned too.
  assert.ok(publicTextFindings("#!/usr/bin/env -S node --api-key=sk-proj1234567890abcdefghij\n").includes("credential-like token"));
  assert.ok(publicTextFindings("#!/usr/bin/env sk-proj1234567890abcdefghij\n").includes("credential-like token"));
  assert.ok(publicTextFindings("#!/usr/bin/env -S node --root=/mnt/server-ssd/work\n").includes("absolute home path"));
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

test("artifact selection ignores workspace equipment outside the output contract, symlinks included", async (t) => {
  // A lyric workspace holds Kitchen's engine with node_modules/.bin symlinks; it is never delivered.
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-select-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "engine/app/node_modules/.bin"), { recursive: true });
  await writeFile(path.join(root, "engine/app/node_modules/tool.js"), "1\n");
  await symlink("../tool.js", path.join(root, "engine/app/node_modules/.bin/tool"));
  await mkdir(path.join(root, "source"));
  await writeFile(path.join(root, "index.html"), "<!doctype html>\n");
  await writeFile(path.join(root, "source/scene.ts"), "export {};\n");
  const output = { entry: "index.html", include: ["index.html", "source/**"], limits: { maxFiles: 10, maxBytes: 4096 } };
  assert.deepEqual((await selectArtifactFiles(root, output)).files, ["index.html", "source/scene.ts"]);
  await symlink("../index.html", path.join(root, "source/link.html"));
  await assert.rejects(selectArtifactFiles(root, output), /Symlinks are not allowed in artifacts: source\/link\.html/u);
  await assert.rejects(selectArtifactFiles(root, { ...output, include: ["**"] }), /Symlinks are not allowed/u);
});
