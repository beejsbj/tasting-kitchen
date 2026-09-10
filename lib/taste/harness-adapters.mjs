import { readdir, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildCodexTurnArgs, parseCodexJsonl, runCodexSession } from "./codex.mjs";
import { buildCursorTurnArgs, parseCursorJsonl, runCursorSession, verifyCursorIdentity } from "./cursor.mjs";
import { ensurePrivateDirectory } from "./files.mjs";
import { verifyObservedIdentity } from "./identity.mjs";

const CAPABILITIES = ["files", "shell"];

const PROFILES = {
  "codex-cli": {
    id: "codex-linux-host-unsandboxed-v1", label: "via Codex CLI · host-unsandboxed fallback",
    runtime: "linux-host", sandbox: "danger-full-access", approvalPolicy: "never", nativeWeb: "disabled",
    networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary",
  },
  "cursor-agent": {
    id: "cursor-linux-host-unsandboxed-v1", label: "via Cursor Agent · host-unsandboxed",
    runtime: "linux-host", sandbox: "disabled", approvalPolicy: "force", nativeWeb: "not-enforced",
    networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary",
  },
};

function copyConfiguration(variant) {
  return { ...variant, capabilities: [...variant.capabilities], executionProfile: { ...variant.executionProfile } };
}

function validateConfiguration(variant, harness) {
  if (!variant || variant.harness !== harness) throw new Error(`${harness} adapter requires a ${harness} configuration`);
  if (!Array.isArray(variant.capabilities) || JSON.stringify(variant.capabilities) !== JSON.stringify(CAPABILITIES)) {
    throw new Error(`${harness} adapter declares exactly ${CAPABILITIES.join(" and ")} capabilities`);
  }
  const expected = PROFILES[harness];
  for (const [key, value] of Object.entries(expected)) {
    if (variant.executionProfile?.[key] !== value) throw new Error(`${harness} execution profile.${key} must be ${value}`);
  }
  return copyConfiguration(variant);
}

async function prepareCodexAttempt({ codexHome, authPath, env = {} }) {
  const authSource = authPath ?? env.TASTE_CODEX_AUTH_PATH ?? path.join(os.homedir(), ".codex", "auth.json");
  await ensurePrivateDirectory(codexHome);
  const source = path.resolve(authSource);
  let info;
  try { info = await stat(source); }
  catch (error) { throw new Error(`Codex auth source is unavailable: ${source}`, { cause: error }); }
  if (!info.isFile()) throw new Error(`Codex auth source is not a regular file: ${source}`);
  await symlink(source, path.join(codexHome, "auth.json"));
  const entries = await readdir(codexHome);
  if (entries.length !== 1 || entries[0] !== "auth.json") throw new Error("Fresh attempt Codex home may contain only auth.json before launch");
}

function reconstructCodexTurn(eventsText) {
  return parseCodexJsonl(eventsText);
}

function reconstructCursorTurn(eventsText) {
  return parseCursorJsonl(eventsText);
}

const adapters = new Map([
  ["codex-cli", {
    harness: "codex-cli",
    capabilities: CAPABILITIES,
    validate: (variant) => validateConfiguration(variant, "codex-cli"),
    planTurn: buildCodexTurnArgs,
    prepareAttempt: prepareCodexAttempt,
    execute: runCodexSession,
    verifyIdentity: verifyObservedIdentity,
    reconstructTurn: reconstructCodexTurn,
  }],
  ["cursor-agent", {
    harness: "cursor-agent",
    capabilities: CAPABILITIES,
    validate: (variant) => validateConfiguration(variant, "cursor-agent"),
    planTurn: buildCursorTurnArgs,
    prepareAttempt: async () => ({}),
    execute: runCursorSession,
    verifyIdentity: verifyCursorIdentity,
    reconstructTurn: reconstructCursorTurn,
  }],
]);

/** Internal, fixed runner allowlist. Catalog data cannot install adapters or executables. */
export function getHarnessAdapter(harness) {
  const adapter = adapters.get(harness);
  if (!adapter) throw new Error(`Unsupported execution harness: ${String(harness)}`);
  return adapter;
}

/** Validate and copy configuration without touching credentials, disk, or a model process. */
export function resolveHarnessAdapter(variant) {
  const adapter = getHarnessAdapter(variant?.harness);
  return { adapter, variant: adapter.validate(variant) };
}

export function adapterSupport(variant) {
  try {
    resolveHarnessAdapter(variant);
    return null;
  } catch (error) {
    return error.message;
  }
}
