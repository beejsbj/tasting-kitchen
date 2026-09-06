const STEP_COUNT = 8;

function validatePattern(steps, offset) {
  if (
    !Array.isArray(steps) ||
    steps.length !== STEP_COUNT ||
    steps.some((step) => typeof step !== "number" || !Number.isFinite(step) || (step !== 0 && step !== 1)) ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 7
  ) {
    throw new RangeError("steps must contain exactly eight numeric 0/1 values and offset must be an integer from 0 to 7");
  }
}

export function echo(steps, offset) {
  validatePattern(steps, offset);
  const reversed = [...steps].reverse();
  if (offset === 0) return reversed;
  return [...reversed.slice(-offset), ...reversed.slice(0, -offset)];
}

export function encode(steps, offset) {
  validatePattern(steps, offset);
  return `#echo=${steps.join("")}.${offset}`;
}

export function decode(fragment) {
  if (typeof fragment !== "string") return null;
  const match = /^#echo=([01]{8})\.([0-7])$/.exec(fragment);
  if (!match) return null;
  return {
    steps: [...match[1]].map(Number),
    offset: Number(match[2]),
  };
}

export function frameAt(elapsedMs) {
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= 4800) return null;
  const slot = Math.floor(elapsedMs / 300);
  return slot < STEP_COUNT
    ? { phrase: "call", index: slot }
    : { phrase: "response", index: slot - STEP_COUNT };
}
