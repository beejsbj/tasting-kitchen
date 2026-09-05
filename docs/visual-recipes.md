# Visual Recipe contract

The first visual Menu consists of four ready Recipes:

- `responsive-product-launch`
- `editorial-culture-feature`
- `shared-result-ritual`
- `extend-design-system-without-flattening-it`

Each Recipe presents all known constraints in one turn. The generated result is a static web Dish with `index.html` as its entry point. The `presentation` profile is `static-web-v1` with no semantic runtime. The gallery presents the Dish in an opaque sandbox that permits scripts. Published resources must therefore use relative paths and may not depend on network access or same-origin privileges.

## Fixtures and published output

The runner mounts source material below `fixtures/` and the Recipe validator below `validation/`. Those directories are working inputs; they are not automatically copied into the accepted Dish. Each prompt explicitly requires the Cook to copy or embed every runtime dependency within the allowed published output paths.

Factual inputs, media, and validators are immutable fixtures. The design-system Recipe also supplies editable component and token sources because changing those source files is the task. Their original bytes remain part of the Recipe revision even though the Cook may edit the mounted copies.

## Automated acceptance

The validators cover structural facts that can be established without a browser:

- The general web validators require `index.html` and every published file to be nonempty. The design-system validator requires its declared entry, assets, source modules, and decision ledger to be nonempty.
- Published JavaScript modules must pass Node's syntax check. The validator does not execute them because browser modules may validly reference the DOM at module scope.
- The editorial Dish must publish the supplied map at `assets/night-map.svg`.
- The design-system Dish must publish its entry, stylesheet, styleguide module, declared source modules, token sheet, and `system-decisions.json`.
- The design decision ledger must contain one `promote`, one `prune`, and one `keepLocal` choice. Each choice names a distinct JavaScript symbol, a nonempty reason, and an existing JavaScript source under `src/`.

These checks establish packaging, parseability, and inspectable decision metadata. They do not prove browser behavior or visual quality. Acceptance also records manual browser observations for factual fidelity, responsive layouts, keyboard use, reduced-motion behavior, and reachable interactive states. For the design-system Dish, review also compares actual imports and exports with the decision ledger and confirms that all three product contexts are visible.

## Revision history

`responsive-product-launch` and `shared-result-ritual` use Recipe revision `2.0.0`; their accepted `1.0.0` Dish revisions remain immutable and resolvable. `editorial-culture-feature` and `extend-design-system-without-flattening-it` remain at `1.0.0` because they had no accepted Dish revision before this authoring pass. The presentation profile, fixture editability, prompts, and validators are execution material for these new revisions.
