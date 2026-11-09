// Loaded with --import by the test scripts: each test process cooks in its own
// throwaway runtime root, never the real default under /var/tmp, and never a
// TASTE_RUNTIME_ROOT exported in the shell that runs the tests. A child process
// a test spawns inherits the parent's root. Without this module, the runtime
// refuses the real root under the test runner (runtime-root.mjs).
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.env.TASTE_TEST_RUNTIME_ROOT_OWNER === undefined || !process.env.TASTE_RUNTIME_ROOT) {
  const root = mkdtempSync(path.join(os.tmpdir(), "taste-runtime-"));
  process.env.TASTE_RUNTIME_ROOT = root;
  process.env.TASTE_TEST_RUNTIME_ROOT_OWNER = String(process.pid);
  process.on("exit", () => rmSync(root, { recursive: true, force: true }));
}
