# Translation contract

- At 108 BPM in 4/4, one bar-long cycle is 2222.222 ms.
- `@x` expresses event duration as a fraction of one cycle.
- `~` represents a rest.
- Absolute pitch may use `note("...")`; relative pitch may use `n("...").scale("A4:minor")`.
- Simultaneous or materially overlapping voices may be separated with `stack(...)` rather than collapsed.
- Velocity may be expressed with `.gain(...)` or a documented equivalent. Do not claim event-level fidelity if the chosen notation only applies one value to a whole pattern.
- Round derived values to at most four decimal places, but do not erase the pickup or musically meaningful overlap solely to make prettier decimals.
- Use ordinary documented Strudel functions; do not invent converter-specific syntax.
