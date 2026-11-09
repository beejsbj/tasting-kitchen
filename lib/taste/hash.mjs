import { createHash } from "node:crypto";

// Canonical JSON and hashing live apart from the catalog so lower modules (environments) can hash without importing it.
export function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not support non-finite numbers");
    return;
  }
  if (typeof value !== "object") throw new TypeError(`Canonical JSON does not support ${typeof value} values`);
  if (seen.has(value)) throw new TypeError("Canonical JSON does not support circular values");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, seen);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON only supports plain objects and arrays");
    }
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || typeof item === "function" || typeof item === "symbol") {
        throw new TypeError(`Canonical JSON does not support the value at ${key}`);
      }
      assertJsonValue(item, seen);
    }
  }
  seen.delete(value);
}

function serializeCanonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serializeCanonical).join(",")}]`;
  const keys = Object.keys(value).sort(compareText);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${serializeCanonical(value[key])}`).join(",")}}`;
}

/** Return compact JSON with recursively sorted object keys. Array order is significant. */
export function canonicalJson(value) {
  assertJsonValue(value);
  return serializeCanonical(value);
}

/** Hash bytes or text, using the hash spelling used by recipe and dish manifests. */
export function sha256(value) {
  if (typeof value !== "string" && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError("sha256 expects a string, Buffer, or Uint8Array");
  }
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function hashCanonical(value) {
  return sha256(canonicalJson(value));
}
