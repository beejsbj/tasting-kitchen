function rangeError(message) {
  throw new RangeError(message);
}

export function quote(lines, rates) {
  if (!Array.isArray(lines)) rangeError("Estimate lines must be an array.");

  const labourRates = Array.isArray(rates?.labour) ? rates.labour : [];
  const materialRates = Array.isArray(rates?.materials) ? rates.materials : [];
  const quotedLines = [];
  let totalCents = 0;

  for (const [index, line] of lines.entries()) {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      rangeError(`Estimate line ${index + 1} is not valid.`);
    }

    const catalog = line.kind === "labour"
      ? labourRates
      : line.kind === "material"
        ? materialRates
        : null;
    if (!catalog) rangeError(`Estimate line ${index + 1} has an unknown kind.`);

    const rate = catalog.find(candidate => candidate?.id === line.id);
    if (!rate) rangeError(`Estimate line ${index + 1} has an unknown rate.`);

    const maximum = line.kind === "labour" ? 16 : 10;
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > maximum) {
      rangeError(`${line.kind} quantity must be an integer from 1 to ${maximum}.`);
    }

    const unitCents = rate.unitCents;
    const lineTotalCents = unitCents * line.quantity;
    quotedLines.push({
      kind: line.kind,
      id: line.id,
      quantity: line.quantity,
      unitCents,
      totalCents: lineTotalCents
    });
    totalCents += lineTotalCents;
  }

  return { lines: quotedLines, totalCents };
}
