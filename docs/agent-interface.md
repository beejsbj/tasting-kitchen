# Kitchen agent interface

Import `lib/taste/index.mjs` for machine use. The interface is read-first and
never runs a model unless `cook(..., { execute: true })` is requested.

- `discover(repoRoot)` lists private catalog Recipes, configurations, Cuisines,
  Menus, immutable Recipe and configuration revisions, and accepted Dishes.
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
compatibility alias. `taste inspect` requires exactly one selector:
`--recipe`, `--menu`, or `--revision`. Commands reject irrelevant flags and
extra positionals. `--execute` also requires `TASTE_ALLOW_MODEL_RUNS=1`.
Failed executed cells make `taste cook` exit nonzero. With `--json`, failures
use stderr envelopes `{ "error": { "code": "INVALID_ARGUMENT" | "TASTE_ERROR", "message": "..." } }`. Usage errors use `INVALID_ARGUMENT`; unexpected failures use `TASTE_ERROR`. Executed cell failures retain the structured cook report on stdout and set a nonzero exit status. `taste validate --json` returns `{ status, errors, output }`; `taste <command> --help --json` returns `{ help }`.

`TASTE_BASE_PATH` controls CLI registry URLs and defaults to `/`. Public
fixture URLs preserve a safe file extension from the pinned fixture path, so
their media type can be served correctly. Registry staging replaces the
fixture and Dish trees atomically from accepted, ready Recipe snapshots only.
`configurationRevisions` in the registry contains the exact configurations
referenced by public Dishes, so a historical Dish remains interpretable after a
current configuration changes.

Recipes may optionally declare execution-affecting presentation metadata:
`presentation: { profile: string, semanticRuntime: null | { id: string,
version: string } }`. It is included only when present, so legacy revision
hashes remain unchanged. Fixture `editable: true` is also explicit hash
material; all other frozen fixture bytes are checked again before publication.

Only `static-web-v1` with a null semantic runtime is implemented for explicit presentation declarations. Unknown profiles and non-null runtimes are reported as unsupported by planning; legacy Recipes without presentation metadata remain supported by their existing renderer.

```js
import { discover, inspect, cook } from "./lib/taste/index.mjs";

const repoRoot = process.cwd();
const catalog = await discover(repoRoot);
const brief = await inspect(repoRoot, { recipeId: "responsive-product-launch" });
const preview = await cook(repoRoot, {
  configurationId: "codex-sol-high",
  menuId: "visual-ui",
  intent: "fill-missing",
}); // No workspace, revision or model execution side effects.
```

Do not select a default model implicitly in automation. Use a discovered configuration ID and inspect the exact revision hashes returned by the plan before requesting execution.
