# Bounded Strudel crib

Use ordinary Strudel mini-notation and documented pattern functions only. A minimal sounding pattern can use `s("bd sd")`, `note("c3 eb3").sound("sine")`, `stack(...)`, `.slow(n)`, `.fast(n)`, `.gain(n)`, `.pan(n)`, `.lpf(n)`, `.room(n)`, `.sometimes(fn)`, `.bank("RolandTR909")`, and `.cpm(n)`. Angle brackets choose one item per cycle; square brackets subdivide a step; `~` is a rest; `*n` repeats. Prefer a small runnable piece over speculative APIs. Do not use network-loaded samples.
