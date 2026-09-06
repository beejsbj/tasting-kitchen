# Visual Kitchen release

Approved direction: 2026-09-05. Build the first usable Kitchen around visual design and UI, then add other Recipes and presentation capabilities as they become useful.

The canonical product model in `product-model.md` remains authoritative. This release implements that model; it does not require the full historical catalog's taste interviews to finish.

## First Menu

Four task shapes provide a deliberately varied starting point:

- `responsive-product-launch`: a recognizable product-page brief.
- `editorial-culture-feature`: long-form editorial composition.
- `shared-result-ritual`: an expressive shared-result interaction.
- `extend-design-system-without-flattening-it`: continuation of an existing visual system.

Keep the existing accepted Dishes immutable. Preserve their exact executed Recipe definitions before changing current briefs. Existing outputs remain historical comparisons when a brief changes. Every other Recipe is deferred from this release's taste audit; retain its source and provenance. Metadata migration may cover the whole catalog without forcing editorial decisions about its membership.

The September 6 discussion corrections and browsing contract are recorded in [kitchen-experience.md](kitchen-experience.md).

## Kitchen for people

The public gallery leads with Recipes and real Dishes. A visitor can inspect the task and its supplied inputs, open a runnable artifact, compare configurations on the same exact Recipe Revision, select another Repeat, and browse a Menu with honest coverage. Model-family browsing does not imply constant configuration. Missing cells stay visible inside eligible Menus; uncooked Recipes stay private.

The visual system must give this a recognizable working-Kitchen character while keeping artifacts dominant. Responsive layouts, keyboard navigation, clear focus, loading and failure states, and reduced-motion behavior are part of the product. A local style-guide surface imports the same components as the application.

## Kitchen for agents

Provide one importable local API and a non-interactive CLI over the same implementation. Agents can discover Recipes, Menus and configurations; inspect exact briefs and input contracts; dry-plan; choose fill-missing or Repeat intent; execute explicitly; inspect results; and build the gallery index. Machine-readable output, actionable errors and meaningful exit status are required.

V1 cooking remains local and owner-operated. The public site has no execution endpoint. The authenticated Cook UI and multiple execution harnesses remain later work.

## Proof of completion

- Canonical Cuisines, executed Recipe/Menu Revisions and derived Repeats work through the CLI/API and gallery.
- Existing accepted Dish files remain byte-for-byte unchanged and resolve to their original Recipe and configuration.
- The four proposed Recipes have reviewable, self-contained briefs and compatible validation/presentation contracts.
- Tests demonstrate safe dry planning, explicit reuse/repeat intent, revision changes, overlapping Menus, incomplete configuration coverage and immutable publication.
- Browser checks cover desktop and phone browsing, comparison, input inspection, URL/history state and keyboard operation.
- The first public Menu is eligible only after every pinned Recipe Revision has real accepted output. No generated demonstration fixture is presented as a model Dish.
- The release has a documented build, serving, smoke-check and recovery path. Live model cooking and deployment are recorded separately from local implementation and verification.

Later output families may require additional presentation runtimes. Extensibility means those can be added at the existing output/presentation boundary; this release does not prebuild their interfaces.
