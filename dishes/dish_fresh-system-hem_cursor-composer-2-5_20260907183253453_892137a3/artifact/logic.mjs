function reject(message) {
  throw new RangeError(message);
}

export function quote(lines, rates) {
  if (!Array.isArray(lines)) reject("Estimate lines must be an array.");

  const labourRates = Array.isArray(rates?.labour) ? rates.labour : [];
  const materialRates = Array.isArray(rates?.materials) ? rates.materials : [];
  const quoted = [];
  let totalCents = 0;

  for (const [index, line] of lines.entries()) {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      reject(`Estimate line ${index + 1} is not valid.`);
    }

    const catalog = line.kind === "labour"
      ? labourRates
      : line.kind === "material"
        ? materialRates
        : null;
    if (!catalog) reject(`Estimate line ${index + 1} has an unknown kind.`);

    const rate = catalog.find(entry => entry?.id === line.id);
    if (!rate) reject(`Estimate line ${index + 1} has an unknown rate.`);

    const max = line.kind === "labour" ? 16 : 10;
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > max) {
      reject(`${line.kind} quantity must be an integer from 1 to ${max}.`);
    }

    const unitCents = rate.unitCents;
    const lineTotal = unitCents * line.quantity;
    quoted.push({ kind: line.kind, id: line.id, quantity: line.quantity, unitCents, totalCents: lineTotal });
    totalCents += lineTotal;
  }

  return { lines: quoted, totalCents };
}
