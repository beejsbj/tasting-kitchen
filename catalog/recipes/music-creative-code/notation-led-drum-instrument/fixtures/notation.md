# Tiny drum notation

The artifact parses this intentionally small grammar:

- One line is one 4/4 cycle.
- Four whitespace-separated groups are the four beats.
- A token is one of `bd`, `sd`, `hh`, `oh`, `rim`, or `~` for rest.
- Brackets subdivide one beat evenly: `[hh hh]` is two hats inside that beat; `[bd hh hh]` is three equal events.
- Comma-separated tokens inside braces sound together: `{bd,hh}`.
- Lines beginning with `#` are comments and do not sound.

The browser instrument only needs to parse this grammar. Reject an invalid edit with a local, specific message while continuing to preserve the last valid pattern.
