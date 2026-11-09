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

// Live runs use his real homes. A test that forgets to point them at a fake must fail on a
// missing directory, never reach the real ~/.codex or ~/.hermes.
if (!process.env.TASTE_CODEX_LIVE_HOME) process.env.TASTE_CODEX_LIVE_HOME = path.join(process.env.TASTE_RUNTIME_ROOT, "no-real-codex-home");
if (!process.env.TASTE_HERMES_ROOT) process.env.TASTE_HERMES_ROOT = path.join(process.env.TASTE_RUNTIME_ROOT, "no-real-hermes-root");
