import type { Configuration, SetupReceipt } from "../types";

// Kept free of local runtime imports so node's type-stripping test runner can load it.
type Source = Pick<Configuration, "harness" | "executionProfile">;

/** Where a live Run writes, by harness: the receipt says so plainly rather than leave it to be assumed. */
const LIVE_HOMES: Record<string, { home: string; writes: string }> = {
  "claude-code": { home: "~/.claude", writes: "sessions, history and auto-memory" },
  "codex-cli": { home: "~/.codex", writes: "session rollouts, history, logs and, when his config enables them, memories" },
  "cursor-agent": { home: "~/.cursor", writes: "chats and CLI state" },
  hermes: { home: "", writes: "its session database, memory and plugin hooks" },
};

/** The home a live Run used: "~/.codex", or "otto profile" for Hermes. */
export function liveHomeName({ harness, executionProfile }: Source) {
  if (harness === "hermes") return `${executionProfile.harnessProfile ?? "named"} profile`;
  return LIVE_HOMES[harness]?.home ?? "his real home";
}

/** "his real ~/.codex, writes kept (session rollouts, …) · a1b2c3d4 at start". */
export function liveSetupLine(config: Source, setup: Pick<SetupReceipt, "digestAtStart">, shortHash: (hash: string) => string) {
  const writes = LIVE_HOMES[config.harness]?.writes;
  return `his real ${liveHomeName(config)}, writes kept${writes ? ` (${writes})` : ""}${setup.digestAtStart ? ` · ${shortHash(setup.digestAtStart)} at start` : ""}`;
}

/** The memory row of a live receipt. Harnesses that cannot switch memory off say so. */
export function liveMemoryLine(config: Source, memory: "on" | "off") {
  if (memory === "off") return "off";
  if (config.harness === "codex-cli") return "on · as his config has it, not forced · writes to his real memory when enabled";
  if (config.harness === "cursor-agent") return "on · his account's memory · this harness cannot switch it off";
  if (config.harness === "hermes") return "on · the profile's own memory, writes kept · this harness cannot switch it off";
  return "on · writes to your real memory";
}

/** The connections row of a live receipt: what off actually withheld, per harness (Cursor offers no off). */
export function liveConnectionsOff(config: Source) {
  if (config.harness === "hermes") return "off · the model gets file and terminal tools only; the profile's MCP servers and plugins can still start";
  if (config.harness === "codex-cli") return "off · plugins, apps and each MCP server in his config switched off";
  return "off";
}
