import { stat } from "node:fs/promises";
import os from "node:os";

/**
 * A writable directory on a different filesystem from os.tmpdir(), for
 * cross-device tests; null when this machine has none to offer.
 */
export async function otherFilesystem() {
  const home = (await stat(os.tmpdir())).dev;
  for (const candidate of ["/dev/shm", "/run/shm"]) {
    try {
      const info = await stat(candidate);
      if (info.isDirectory() && info.dev !== home) return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return null;
}
