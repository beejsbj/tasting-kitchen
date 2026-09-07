function validate(steps, offset) {
  if (!Array.isArray(steps) || steps.length !== 8) {
    throw new RangeError("steps must be an array of exactly eight 0/1 values");
  }
  for (const bit of steps) {
    if (bit !== 0 && bit !== 1) {
      throw new RangeError("steps must be an array of exactly eight 0/1 values");
    }
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 7) {
    throw new RangeError("offset must be an integer from 0 to 7");
  }
}

export function echo(steps, offset) {
  validate(steps, offset);
  const reversed = [...steps].reverse();
  if (offset === 0) return reversed;
  const n = offset;
  return [...reversed.slice(-n), ...reversed.slice(0, -n)];
}

export function encode(steps, offset) {
  validate(steps, offset);
  const bits = steps.map((b) => String(b)).join("");
  return `#echo=${bits}.${offset}`;
}

export function decode(fragment) {
  if (typeof fragment !== "string") return null;
  const match = /^#echo=([01]{8})\.([0-7])$/.exec(fragment);
  if (!match) return null;
  const steps = match[1].split("").map((c) => Number(c));
  const offset = Number(match[2]);
  return { steps, offset };
}

export function frameAt(elapsedMs) {
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs)) return null;
  if (elapsedMs < 0 || elapsedMs >= 4800) return null;
  const slot = Math.floor(elapsedMs / 300);
  if (slot < 8) return { phrase: "call", index: slot };
  return { phrase: "response", index: slot - 8 };
}
