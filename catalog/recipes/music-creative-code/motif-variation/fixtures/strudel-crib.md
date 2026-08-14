# Bounded Strudel crib

Use ordinary Strudel mini-notation and documented pattern functions only. A minimal sounding pattern can use `s("bd sd")`, `note("d4 f4 g4 e4").sound("triangle")`, `n("0 2 3 1").scale("D4:minor")`, `stack(...)`, `.slow(n)`, `.fast(n)`, `.gain(n)`, `.pan(n)`, `.lpf(n)`, `.room(n)`, and `.cpm(n)`. Angle brackets choose one item per cycle; square brackets subdivide a step; `~` is a rest; `@n` stretches an event; `*n` repeats. Prefer a small runnable piece over speculative APIs. Do not use network-loaded samples.
