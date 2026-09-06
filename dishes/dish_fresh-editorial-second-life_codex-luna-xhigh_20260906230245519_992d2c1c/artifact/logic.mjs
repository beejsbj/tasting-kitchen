const VALID_PERIODS = new Set(["all", "spring", "summer"]);

export function summarize(rows, period) {
  if (!VALID_PERIODS.has(period)) {
    throw new RangeError(`Unsupported period: ${period}`);
  }

  const selected = period === "all"
    ? rows
    : rows.filter((row) => row.season === period);

  return selected.reduce((summary, row) => ({
    months: summary.months + 1,
    loans: summary.loans + row.loans,
    loanedKg: summary.loanedKg + row.loanedKg,
    returnedKg: summary.returnedKg + row.returnedKg,
  }), {
    months: 0,
    loans: 0,
    loanedKg: 0,
    returnedKg: 0,
  });
}
