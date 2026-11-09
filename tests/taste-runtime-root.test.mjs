import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ISOLATION_MARKERS, ancestry, assertIsolatedWorkspace, cookDirectoryFor, createCookDirectory, resolveRuntimeRoot,
} from "../lib/taste/runtime-root.mjs";

async function scratch(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-site-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("the runtime root defaults outside the home directory and accepts only an absolute override", () => {
  const uid = process.getuid?.() ?? os.userInfo().username;
  assert.equal(resolveRuntimeRoot({ TASTE_RUNTIME_ROOT: "" }).startsWith(os.homedir()), false);
  const saved = process.env.TASTE_RUNTIME_ROOT;
  delete process.env.TASTE_RUNTIME_ROOT;
  try { assert.equal(resolveRuntimeRoot({}), `/var/tmp/tk-${uid}`); }
  finally { if (saved !== undefined) process.env.TASTE_RUNTIME_ROOT = saved; }
  assert.equal(resolveRuntimeRoot({ TASTE_RUNTIME_ROOT: "/srv/cook/" }), "/srv/cook/");
  assert.throws(() => resolveRuntimeRoot({ TASTE_RUNTIME_ROOT: "relative/cook" }), /absolute path/);
});

test("ancestry walks every directory up to the filesystem root", () => {
  assert.deepEqual(ancestry("/a/b/c"), ["/a/b/c", "/a/b", "/a", "/"]);
});

test("the guard refuses a workspace with any project marker in it or above it, and passes a clean one", async (t) => {
  const root = await scratch(t);
  const workspace = path.join(root, "runtime", "0123456789abcdef", "workspace");
  await mkdir(workspace, { recursive: true });
  await assertIsolatedWorkspace(workspace);
  for (const marker of ISOLATION_MARKERS) {
    for (const where of [workspace, path.join(root, "runtime"), root]) {
      const target = path.join(where, marker);
      if (marker.startsWith(".") && marker !== ".git") await mkdir(target);
      else await writeFile(target, "");
      await assert.rejects(assertIsolatedWorkspace(workspace), (error) => error.stage === "preparation" && error.message.includes(target), `${marker} in ${where}`);
      await rm(target, { recursive: true, force: true });
    }
  }
  await assertIsolatedWorkspace(workspace);
});

test("the guard follows a symlinked runtime root to the checkout it really sits in", async (t) => {
  const root = await scratch(t);
  const checkout = path.join(root, "checkout");
  await mkdir(path.join(checkout, "private", "cook", "workspace"), { recursive: true });
  await writeFile(path.join(checkout, "AGENTS.md"), "# Kitchen guidance\n");
  await symlink(path.join(checkout, "private", "cook"), path.join(root, "innocent"));
  await assert.rejects(assertIsolatedWorkspace(path.join(root, "innocent", "workspace")), /AGENTS\.md/);
});

test("a cook directory is opaque, private, and refuses a planted or shared runtime root", async (t) => {
  const root = await scratch(t);
  const runtime = path.join(root, "runtime");
  const first = await createCookDirectory({ env: { TASTE_RUNTIME_ROOT: runtime } });
  const second = await createCookDirectory({ env: { TASTE_RUNTIME_ROOT: runtime } });
  assert.notEqual(first, second);
  for (const directory of [first, second]) {
    assert.equal(path.dirname(directory), runtime);
    assert.match(path.basename(directory), /^[a-f0-9]{16}$/u);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
  }
  assert.equal((await stat(runtime)).mode & 0o777, 0o700);
  await assert.rejects(createCookDirectory({ env: { TASTE_RUNTIME_ROOT: runtime }, nonce: "demo-session" }), /16 lowercase hex/);

  const planted = path.join(root, "planted");
  await symlink(runtime, planted);
  await assert.rejects(createCookDirectory({ env: { TASTE_RUNTIME_ROOT: planted } }), /real directory/);
  const shared = path.join(root, "shared");
  await mkdir(shared);
  await chmod(shared, 0o777);
  await assert.rejects(createCookDirectory({ env: { TASTE_RUNTIME_ROOT: shared } }), /group- or world-writable/);
  assert.deepEqual(await readdir(shared), []);
});

test("recovery reads the recorded cook directory and refuses an unsafe one; legacy attempts cooked in place", () => {
  const attemptDir = "/repo/private/runtime/attempts/attempt_x";
  assert.equal(cookDirectoryFor({}, attemptDir), attemptDir);
  assert.equal(cookDirectoryFor({ cookDirectory: "/var/tmp/tk-1/0123456789abcdef" }, attemptDir), "/var/tmp/tk-1/0123456789abcdef");
  for (const unsafe of ["relative/0123456789abcdef", "/var/tmp/tk-1/../0123456789abcdef", "/var/tmp/tk-1/demo-session", 7]) {
    assert.throws(() => cookDirectoryFor({ cookDirectory: unsafe }, attemptDir), /unsafe cook directory/);
  }
});
