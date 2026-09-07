# Visual Kitchen release

Approved direction: 2026-09-05. Build the first usable Kitchen around visual design and UI, then add other Recipes and presentation capabilities as they become useful.

The canonical product model in `product-model.md` remains authoritative. This release implements that model; it does not require the full historical catalog's taste interviews to finish.

## Active public catalog

The active public catalog has ten ready Recipes and ten accepted Dishes. Four fresh authored candidates are collected in `fresh-visual-ui`: `fresh-product-span`, `fresh-editorial-second-life`, `fresh-interaction-paper-echo`, and `fresh-system-hem`. Each active Recipe has one `codex-luna-xhigh` Dish requested at extra-high reasoning on the default service tier. The public registry contains these ten Dishes and no artifact reviews.

Three conventional website baselines are collected in `standard-web`: `standard-service-business`, `standard-developer-portfolio`, and `standard-developer-homepage`. They reveal familiar business, personal portfolio, and Tailwind-style developer-product work. See [standard-web-recipes.md](standard-web-recipes.md) for their supplied packets and review boundaries.

The three active source extensions are in `design-system-extensions`: Conduit, P5 Lottery (`extend-qrng-design-system`), and Emotitone. Northstar is not active. Fifty-four old Recipes, including `responsive-product-launch`, `shared-result-ritual`, and `permission-ladder-publish`, are hidden in `catalog/archive.json` and omitted from the public Book.

Keep the historical accepted Dishes immutable. Their exact executed Recipe definitions and outputs remain recoverable but are not public gallery content for this release. Every other archived Recipe is deferred from this release's taste audit; retain its source and provenance. Metadata migration may cover the whole catalog without forcing editorial decisions about its membership.

The September 6 discussion corrections and browsing contract are recorded in [kitchen-experience.md](kitchen-experience.md).

## Kitchen for people

The default Dishes view now starts with the ten accepted active results. Each Dish and Repeat is separately visible under its Recipe, so configuration and iteration are not hidden in per-card tabs. A visitor can inspect the task and its supplied inputs, open a runnable artifact, compare configurations on the same exact Recipe Revision, select another Repeat, and browse a Menu with honest coverage. The separate Recipe view (`?view=recipes`) shows current authored prompts, briefs and public source inputs, including uncooked Recipes when present. `?view=recipes&edit=<id>` opens an editor.

The visual system must give this a recognizable working-Kitchen character while keeping artifacts dominant. Responsive layouts, keyboard navigation, clear focus, loading and failure states, and reduced-motion behavior are part of the product. A local style-guide surface imports the same components as the application.

## Recipe Book and Kitchen for agents

The local Vite API serves `GET /api/recipes` and same-origin optimistic `PATCH /api/recipes/:id`; an expected file hash protects against stale saves and execution-affecting edits bump the Recipe patch version. Production serves `public/data/recipe-book.json` with active public source text. Hosted saves require an owner-supplied fine-grained GitHub token with repository Contents read/write access, commit once atomically to `VITE_RECIPE_BRANCH` (default `main`), and never run a model.

Provide one importable local API and a non-interactive CLI over the same implementation. Agents can discover Recipes, Menus and configurations; inspect exact briefs and input contracts; dry-plan; choose fill-missing or Repeat intent; execute explicitly; inspect results; and build the gallery index. Machine-readable output, actionable errors and meaningful exit status are required.

V1 cooking remains local and owner-operated. The public site has no execution endpoint. The authenticated Cook UI and multiple execution harnesses remain later work.

## Proof of completion

- Canonical Cuisines, executed Recipe/Menu Revisions and derived Repeats work through the CLI/API and gallery.
- Historical accepted Dish files remain byte-for-byte unchanged and recoverable with their original Recipe and configuration.
- The four fresh Recipes have reviewable, self-contained briefs and compatible validation/presentation contracts.
- Tests demonstrate safe dry planning, explicit reuse/repeat intent, revision changes, overlapping Menus, incomplete configuration coverage and immutable publication.
- Browser checks cover desktop and phone browsing, comparison, input inspection, URL/history state and keyboard operation.
- The public Book can show uncooked Recipes; a public Menu remains eligible only after every pinned Recipe Revision has real accepted output. No generated demonstration fixture is presented as a model Dish.
- The release has a documented build, serving, smoke-check and recovery path. Live model cooking and deployment are recorded separately from local implementation and verification.

Later output families may require additional presentation runtimes. Extensibility means those can be added at the existing output/presentation boundary; this release does not prebuild their interfaces.
