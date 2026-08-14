import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { publicTextFindings, scanWebArtifactNetwork } from "../lib/taste/files.mjs";

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
