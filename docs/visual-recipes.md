# Visual Recipe contracts

The public Book has ten active Recipes. It includes uncooked authored definitions; a Recipe Book entry is not evidence that a model has produced a Dish.

## Restored cooked Recipes

The original 15 accepted Dishes remain unchanged. Their three original Recipes and exact definitions are restored:

| Recipe ID | Definition |
| --- | --- |
| `responsive-product-launch` | Launch a compact product without hiding the tradeoffs |
| `shared-result-ritual` | Stage a shared result as an event |
| `permission-ladder-publish` | Prepare, pause for approval, publish, then verify |

Displayed Dish cards use the names and prompt definitions frozen into the executed Recipe Revision. The current authored definitions are editable in the separate Recipe Book and do not rewrite those Dishes.

## Fresh visual Recipes

The `fresh-visual-ui` menu contains four ready, uncooked candidates:

| Recipe ID | Subject |
| --- | --- |
| `fresh-product-span` | Span laundry rack product page |
| `fresh-editorial-second-life` | A Second Life for the Moon theatre-materials feature |
| `fresh-interaction-paper-echo` | Paper Echo, a deterministic eight-beat pattern echo |
| `fresh-system-hem` | Hem Estimates garment-repair workflow continuing its supplied system |

Their complete inputs, output contracts, validator boundaries and unsolved human probes are recorded in [fresh-visual-recipes.md](fresh-visual-recipes.md). Ready means supported by the execution boundary; it does not mean cooked, accepted or visually approved. No fresh cooked Dish is claimed here.

## Design-system extensions

`design-system-extensions` has exactly three active variants:

- `extend-conduit-design-system` — Conduit.
- `extend-qrng-design-system` — P5 Lottery.
- `extend-emotitone-design-system` — Emotitone.

Each extension supplies a bounded local snapshot with a pinned upstream commit, original paths and file digests. Conduit includes the requested StyleGuide and supporting React/Tailwind source; P5 Lottery uses the lottery frontend’s actual visual language and a browser starter; Emotitone includes its Vue instrument-panel source and a browser tabs adapter. The briefs identify omitted assets and dependencies. Models adapt and extend these references into self-contained `static-web-v1` artifacts; these are not native patches against the complete upstream applications. Fidelity and reuse still require human inspection.

Northstar is not an active menu member. These variants remain separate Recipe identities with their own supplied systems and extension tasks; comparing models within one exact variant revision does not make different variants like-for-like.

The old `visual-ui` menu and its historical visual candidates are deferred catalog material, not the current four-member public visual menu. Fifty-one other old Recipes are hidden in `catalog/archive.json` and stay outside the public Book.

## Recipe Book editing

Local development exposes `GET /api/recipes` and optimistic `PATCH /api/recipes/:id` saves. The patch carries an `expectedHash`, updates the current definition and public text fixtures atomically, and bumps the patch version when execution-affecting content changes. Production embeds active public source text in `public/data/recipe-book.json`; browser drafts and downloads do not alter the repository.
