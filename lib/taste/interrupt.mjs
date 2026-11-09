/**
 * Interruption of an attempt: a SIGINT or SIGTERM must not leave a copied
 * setup, a borrowed login or a still-running authenticated harness behind.
 * Harness children are spawned detached, in their own process group, and
 * tracked here; an interrupted attempt kills the group, then runs its own
 * cleanup, then the process exits with the conventional signal status.
 * A SIGKILL cannot be caught: that residue is the next cleanup's to remove.
 */
const children = new Set();
const handlers = new Set();
const SIGNALS = { SIGINT: 2, SIGTERM: 15 };
let installed = false;

/** Spawn options that give a harness child its own process group. */
export const DETACHED_CHILD = { detached: true };

export function trackChild(child) {
  children.add(child);
  const forget = () => children.delete(child);
  child.once("close", forget);
  child.once("error", forget);
  return child;
}

export function killTrackedChildren(signal = "SIGKILL") {
  for (const child of children) {
    if (!child.pid) continue;
    try { process.kill(-child.pid, signal); }
    catch { try { child.kill(signal); } catch { /* already gone */ } }
  }
}

async function interrupted(signal) {
  killTrackedChildren("SIGKILL");
  await Promise.allSettled([...handlers].map((handler) => handler(signal)));
  process.exit(128 + SIGNALS[signal]);
}

/** Run `handler` if the process is interrupted while this is registered. Returns the disposer. */
export function onInterrupt(handler) {
  handlers.add(handler);
  if (!installed) {
    installed = true;
    for (const signal of Object.keys(SIGNALS)) process.on(signal, interrupted);
  }
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0 && installed) {
      installed = false;
      for (const signal of Object.keys(SIGNALS)) process.off(signal, interrupted);
    }
  };
}
