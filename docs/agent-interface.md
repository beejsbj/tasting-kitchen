# Kitchen agent interface

Import `lib/taste/index.mjs` for cooking and Recipe Book authoring. The authoring functions are also available from `lib/taste/recipe-book.mjs`. The cooking interface is read-first and never runs a model unless `cook(..., { execute: true })` is requested. Recipe Book saves edit current definitions only; they do not mutate executed Dishes.

- `discover(repoRoot)` lists private catalog Recipes, configurations, Cuisines,
  Menus, skills, and accepted Dishes. Each Recipe lists its current `recipeHash`.
- `inspect(repoRoot, { recipeId | menuId })` returns the current definition (with
  a Recipe's accepted Dishes). Unknown IDs fail.
- `plan(repoRoot, { configurationId, skillId?, recipeIds | menuId, filter })` reports
  supported and unsupported Recipe/configuration cells without side effects.
  `skillId` names a catalog skill layer; omitted or `"none"` cooks without one.
  Recipes that do not list the layer are reported unsupported.
- `cook(repoRoot, { configurationId, recipeIds | menuId, intent, execute })`
  requires `intent: "fill-missing" | "repeat"`. Dry runs report planned,
  skipped-covered, and unsupported cells. Covered means a Dish exists for the
  Recipe's current hash, the configuration hash and the skill layer. Nothing is
  frozen into the catalog; each Dish records its own inputs and receipt.
- `coverage(menu, recipes, dishes, configurationHashes?, skillHashes?)` keeps the complete
  Menu denominator, measured against each member's current recipe hash, and
  reports missing cells explicitly. Skill keys are skill hashes or `"none"`.
- `loadSkills(repoRoot)` exposes the catalog layers and their hashes; `loadPrivateDishes(repoRoot)` lists
  accepted Dishes of private Recipes, which never reach the registry.
- `buildRecipeBook(repoRoot)` returns the active public Recipes, their current
  public source text, Dish counts, and the archived count. Hidden Recipes are
  omitted.
- `saveRecipeEdits(repoRoot, { recipeId, expectedHash, updates })` validates and
  atomically saves an active Recipe's editable fields and public text fixtures.
  The expected hash provides optimistic conflict protection; execution-affecting
  changes bump the patch version.

The CLI mirrors the cooking commands above. Recipe Book authoring functions are
JavaScript APIs, not CLI subcommands. `--config` is canonical; `--variant` remains a
compatibility alias. `taste inspect` requires exactly one selector:
`--recipe` or `--menu`. Commands reject irrelevant flags and
extra positionals. `--execute` also requires `TASTE_ALLOW_MODEL_RUNS=1`.
Failed executed cells make `taste cook` exit nonzero. With `--json`, failures
use stderr envelopes `{ "error": { "code": "INVALID_ARGUMENT" | "TASTE_ERROR", "message": "..." } }`. Usage errors use `INVALID_ARGUMENT`; unexpected failures use `TASTE_ERROR`. Executed cell failures retain the structured cook report on stdout and set a nonzero exit status. `taste validate --json` returns `{ status, errors, output }`; `taste <command> --help --json` returns `{ help }`.

`taste validate` requires full private provenance by default. For a clean public
checkout, use `taste validate --public-checkout [--json]`. This explicitly skips
all private provenance, even when present, while retaining public catalog, Dish,
sidecar, and skill checks. Success output says `private provenance skipped
(--public-checkout)`; JSON mode preserves that text in `output`. The option is
valid only for `validate` and takes no value. Strict success reports the number
of private provenance records checked.

`TASTE_BASE_PATH` controls CLI registry URLs, including the registry rebuilt after an
executed `cook`, and defaults to `/`. Public
fixture URLs preserve a safe file extension from the fixture path, so their
media type can be served correctly. Registry staging replaces the fixture and
Dish trees atomically. Each registry Dish carries `inputs` (its recorded
fixtures, with URLs for public ones) and `receipt` (the configuration and skill
source it ran as) from its own sidecars, so a Dish stays interpretable after the
catalog changes; a Dish without sidecars falls back to the Recipe's current
fixtures. The registry is `schemaVersion: 3` and has no revision arrays.

At publication the runner writes `inputs.json`, `inputs/` and `receipt.json`
beside `dish.json`. They are outside `dishHash`.

Recipes may optionally declare execution-affecting presentation metadata:
`presentation: { profile: string, semanticRuntime: null | { id: string,
version: string } }`. It is included only when present, so legacy recipe
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
  menuId: "fresh-visual-ui",
  intent: "fill-missing",
}); // No workspace or model execution side effects.
```

Do not select a default model implicitly in automation. Use a discovered configuration ID and inspect the recipe hashes returned by the plan before requesting execution.

## Internal runner adapters

Cooking uses a fixed internal adapter allowlist: `codex-cli`, `cursor-agent`,
`claude-code` and `hermes`.
An adapter validates and copies the declared configuration and exact execution
profile, exposes only its actually declared capabilities, plans a turn without
side effects, prepares authentication immediately before launch, runs fresh and
exact-UUID-resumed turns, reconstructs saved stream evidence, and verifies
observed identity. Catalog configuration is data, not a plugin mechanism: an
unknown harness, profile, or capability combination is shown as unsupported by
planning and is rejected again at execution.

The shared runner retains workspace creation, private evidence, and publication
(including the input and receipt sidecars). Test callers may inject a session or verifier after
the allowlisted adapter has been selected; production configuration cannot
inject an executable or adapter. Publication-only recovery selects the adapter
from the recorded request and reconstructs evidence without launching a model;
it needs the Recipe's current hash to equal the attempt's.

### Where cooking happens

The repo holds the Kitchen program; cooking happens elsewhere. Each attempt
gets a cook directory under a runtime root outside any git tree and outside the
checkout: `/var/tmp/tk-<uid>/<16 random hex>/`, holding `workspace/` and the
attempt's harness homes (`codex-home/`, `home/`, `claude-home/`,
`hermes-home/`). The name is random, so no path the model can see names the
Recipe, configuration or model. `TASTE_RUNTIME_ROOT` overrides the root.

The default is not `$XDG_STATE_HOME`: a harness user's home holds `.codex` and
`.cursor` (and on the Kitchen host `~/.local` holds a `package.json`), so a
root under `$HOME` fails the guard below. `/var/tmp` survives a reboot, which
recovery needs. Because it is shared ground, the root must be a real directory
owned by the Cook and not group- or world-writable.

Before any credential or fixture is touched, and again once the workspace is
laid out, an attempt fails closed (stage `preparation`) if the workspace or any
directory above it up to `/`, by lexical or real path, holds `.git`,
`AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, `CLAUDE.local.md`, `GEMINI.md`, `.agents`, `.claude`, `.codex`,
`.cursor` or `package.json`. Harnesses discover instructions, skills, project
settings and a coding posture from those names.

Private evidence stays in `private/runtime/attempts/<attemptId>/`: the request,
execution and identity records, raw turn events, and publication staging.
`requested.json` records the `cookDirectory`; recovery reads the workspace and
Codex home from it. Attempts from before the move have no `cookDirectory` and
recover from their own directory. Publication copies the staged Dish beside
its destination and renames it within that directory, so `private/` may sit on
another filesystem.

### Codex

Every Codex turn gets a fresh `CODEX_HOME` holding only a link to the existing
`auth.json`, with `--ignore-user-config` and `--ignore-rules`. The `clean`
profile (`codex-linux-host-clean-v1`) also gives the child a fresh, empty
`HOME` beside it and unsets the XDG directories: Codex loads user skills from
`$HOME/.agents/skills` whatever `CODEX_HOME` says. The original profile
(`codex-linux-host-unsandboxed-v1`) keeps the real `HOME` and declares no
environment, so its configurations keep their hashes. Codex's own bundled
system skills still load in `clean`: they ship with the harness.
Codex fast-to-priority recovery is a Codex-only historical alias path.

Cursor authentication preflight uses `status --format json` with a ten-second
timeout and bounded captured output. It requires the CLI’s explicit
`authenticated` status and Boolean `isAuthenticated`; exit zero alone also
occurs when logged out. Account fields are discarded. This checks existing
credential presence; it does not certify remote authentication, which must
still succeed during execution. Recovery never runs authentication preflight.

Cursor declares no environment. It could run with an isolated home: it reads
`CURSOR_CONFIG_DIR`, but skills (`~/.cursor`, `~/.claude`, `~/.codex`,
`~/.agents`), policy and CLI state come from `homedir()`, so it would need a
fresh `HOME` with `auth.json` linked under `.config/cursor/`. That is not
enough for `clean`: account-level User Rules can arrive from Cursor's server with
the login (the stream protocol carries a `user_rules` message), and no local
home can remove them. A borrowed `auth.json` could also rotate Burooj's own
Cursor login. `clean` waits on evidence from a real run that the account
contributes nothing.

### Claude Code

`claude-code` runs `claude -p --output-format stream-json --verbose` with the
configuration's `--model` and `--effort`, and resumes later turns with
`--resume <session UUID>`. Each attempt gets a fresh `CLAUDE_CONFIG_DIR`
(`claude-home/`). Inherited `CLAUDE*` and `ANTHROPIC*` variables are dropped, so
a parent Claude Code session cannot pass on its effort or credentials.

Both environments run with:

- an empty MCP config under `--strict-mcp-config`, and claude.ai connectors
  disabled. Burooj's MCP servers reach Gmail, Calendar, Linear and tududi, and
  a Run with bypassed permissions must not cause external side effects;
- only `Bash`, `Edit`, `Glob`, `Grep`, `Read` and `Write`, plus `Skill` in
  `personal` (no web, subagent or scheduling tools). Network access through the shell is not blocked;
- hooks disabled and auto-update off;

`clean` adds `--safe-mode` and no setting sources, and disables CLAUDE.md and
auto-memory, so the home is empty at launch. Claude Code's built-in plugins and
bundled skill list still load: they ship with the harness. The Skill tool is not
offered, so bundled skills cannot be invoked.

`personal` mirrors `CLAUDE.md`, `skills/`, `agents/`, `commands/` and
`output-styles/` from `~/.claude` as symlinks. The links point at the real
files and are writable: a personal Run with bypassed permissions can edit them.
It loads only the user setting source and adds the Skill tool. The workspace
has no ancestor instruction files to exclude (see "Where cooking happens"). It does not mirror `settings.json` (today that file holds only model and
effort defaults, which the configuration overrides, and push-notification
toggles), plugins, or hooks. Session transcripts and any auto-memory a personal
Run writes stay in the attempt home, not in `~/.claude`.

Authentication reuses the existing claude.ai login. The access token is read
from `~/.claude/.credentials.json` (`TASTE_CLAUDE_CREDENTIALS_PATH` overrides it)
and handed to the child on file descriptor 3. It never enters argv, the
environment or the attempt home. Claude Code refreshes credentials by atomic
rename, so a symlinked credentials file would be replaced in the attempt home and
leave Burooj's own login holding a refresh token that may already have been
rotated away. Without a refresh token the child cannot rotate it, so preparation
refuses a token that expires within 30 minutes
(`TASTE_CLAUDE_TOKEN_MARGIN_MS`); running any `claude` command refreshes it.

Identity requires the init model and every main-thread assistant message to
match the request, argv that pins model and effort, a stream CLI version equal to
`claude --version`, the default output style (the configuration's
`personality`) and a tier of `standard`, which is Anthropic's name for the default
tier. The stream does not report effort, so its evidence is the pinned argv; an
organization effort cap could still lower it silently. Other models in the
result's `modelUsage`, such as background calls, are listed as `auxiliaryModels` in the
private `observed.json`.

Hermes runs each turn as `hermes chat --query-file … --oneshot --format
stream-json`, pinned to `--provider`, `-m`, `--reasoning` and the `file,terminal`
toolsets (no web, browser, messaging, cron, kanban, memory or skill tools), and
continues with `--resume <session id>`. Its stream echoes only the requested
model, so identity is verified from the `state.db` Hermes writes: every
main-loop call in `session_model_usage` must carry the requested model, billing
provider and endpoint, and the session must record the requested effort. A
fallback to another model or provider fails the attempt; auxiliary calls such as
titles are disclosed in `observed.json`. The route is part of the execution
profile id (`hermes-linux-host-clean-anthropic-v1`).

A clean Hermes attempt gets a fresh `hermes-home/` holding only a Kitchen-written
`config.yaml` (provider and model; no fallbacks, secrets, plugins or MCP
servers) and runs with `--ignore-rules`, so no SOUL.md, AGENTS.md, memory or
preloaded skill reaches the model. It uses the committed Hermes environment's
own entry point, because the `hermes` launcher would build a new dependency
environment for an unfamiliar home. Hermes borrows the Claude Code login from
`~/.claude/.credentials.json` (a refresh is written back there); its copy in the
attempt home is deleted when the session ends. A personal attempt runs as the
named profile (`-p rose`). Pinned toolsets keep Hermes's memory and skill reviews
from firing, but the session is still recorded in that profile's `state.db` and
the profile's plugin hooks run, so it refuses unless
`TASTE_ALLOW_HERMES_PROFILE_WRITES=1` is set. Hermes reads every AGENTS.md from
the git root down and gives a run its coding posture when it finds a
`package.json` within six levels; the runtime-root guard keeps both out of a
cook directory's ancestry.
