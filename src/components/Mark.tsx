export function Mark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`mark ${compact ? "mark--compact" : ""}`} aria-label="Model Tasting">
      <span>MT</span>
      {!compact && <i>Model tasting</i>}
    </span>
  );
}
