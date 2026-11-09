// Loaded with --import by the test scripts: each test process cooks in its own
// throwaway runtime root instead of the real default under /var/tmp.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.TASTE_RUNTIME_ROOT) {
  const root = mkdtempSync(path.join(os.tmpdir(), "taste-runtime-"));
  process.env.TASTE_RUNTIME_ROOT = root;
  process.on("exit", () => rmSync(root, { recursive: true, force: true }));
}
