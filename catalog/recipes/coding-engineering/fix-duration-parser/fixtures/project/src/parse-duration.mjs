export function parseDuration(value) {
  if (!/^\d+(?:m|h)$/.test(value)) throw new Error("duration must be a whole number followed by m or h");
  return Number.parseInt(value, 10);
}
