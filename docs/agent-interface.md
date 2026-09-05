# Kitchen agent interface

Import `lib/taste/index.mjs` for machine use. The interface is read-first and
never runs a model unless `cook(..., { execute: true })` is requested.

- `discover(repoRoot)` lists private catalog Recipes, configurations, Cuisines,
  Menus, immutable revisions, and accepted Dishes.
- `inspect(repoRoot, { recipeId | menuId | revisionHash })` returns the complete
  current definition or exact immutable snapshot. Unknown IDs and hashes fail.
- `plan(repoRoot, { configurationId, recipeIds | menuId, filter })` reports
  supported and unsupported Recipe/configuration cells without side effects.
- `cook(repoRoot, { configurationId, recipeIds | menuId, intent, execute })`
  requires `intent: "fill-missing" | "repeat"`. Dry runs report planned,
  skipped-covered, and unsupported cells. An executed Menu freezes all member
  Recipe Revisions and its Menu Revision before fanout.
- `coverage(menuRevision, dishes, configurationHashes?)` keeps the complete
  pinned Menu denominator and reports missing cells explicitly.

The CLI mirrors these commands. `--config` is canonical; `--variant` remains a
compatibility alias. `--execute` also requires `TASTE_ALLOW_MODEL_RUNS=1`.
