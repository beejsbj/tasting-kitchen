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
Codex fast-to-priority recovery is a Codex-only historical alias path.

Cursor authentication preflight uses `status --format json` with a ten-second
timeout and bounded captured output. It requires the CLI’s explicit
`authenticated` status and Boolean `isAuthenticated`; exit zero alone also
occurs when logged out. Account fields are discarded. This checks existing
credential presence; it does not certify remote authentication, which must
still succeed during execution. Recovery never runs authentication preflight.

### Claude Code

`claude-code` runs `claude -p --output-format stream-json --verbose` with the
configuration's `--model` and `--effort`, and resumes later turns with
`--resume <session UUID>`. Each attempt gets a fresh `CLAUDE_CONFIG_DIR`
(`claude-home/`). Inherited `CLAUDE*` and `ANTHROPIC*` variables are dropped, so
a parent Claude Code session cannot pass on its effort or credentials.

Every environment runs with:

- only `Bash`, `Edit`, `Glob`, `Grep`, `Read` and `Write`, plus `Skill` in
  `snapshot` and `live` (no web, subagent or scheduling tools). Network access
  through the shell is not blocked;
- auto-update off;
- `includeGitInstructions: false`. Attempt workspaces sit inside the Kitchen
  checkout, and Claude Code's git-status prompt section would otherwise give the
  model the Kitchen's branch and recent commits. The setting also drops Claude
  Code's built-in commit and PR guidance, which no current Recipe uses.
  `GIT_CEILING_DIRECTORIES` stops the model's own `git` at the attempt.

`clean` adds `--safe-mode` and no setting sources, disables hooks, CLAUDE.md,
auto-memory and claude.ai connectors, and pins an empty MCP config under
`--strict-mcp-config`, so the home is empty at launch. Claude Code's built-in
plugins and bundled skill list still load: they ship with the harness. The Skill
tool is not offered, so bundled skills cannot be invoked.

`snapshot` copies a bounded slice of `~/.claude` into the fresh attempt home
and records the digest of exactly those bytes:

- `CLAUDE.md`, with symlinks followed, so the home holds bytes, never a link back;
- each skill, agent, command and output style. A child that lives in a git work
  tree contributes only its tracked files (working-tree bytes, so uncommitted
  edits count); others contribute every regular file minus `.git`. A skill such
  as `cockpit` is a whole repository with chat logs beside it, and copying the
  directory would turn one attempt into gigabytes. A snapshot is capped at 5,000
  files and 64 MiB and fails clearly beyond that;
- `settings.json` reduced to `language`, `alwaysThinkingEnabled`,
  `includeCoAuthoredBy` and `attribution`. Model, effort and permissions are
  pinned by the configuration; hooks, memory and connectors are set by Kitchen;
  the rest of his file is about his terminal;
- with memory on, the memory he builds from his home directory
  (`~/.claude/projects/<home>/memory`, overridable with
  `TASTE_CLAUDE_MEMORY_SOURCE`) into `memory/`. Claude Code keys auto-memory by
  project, and an attempt workspace is a fresh project with none, so
  `autoMemoryDirectory` points the run at the copy;
- with connections on, his user-scoped `mcpServers` from `~/.claude.json`
  (written to `mcp.json` and passed by path, so no server secret enters argv) and
  his plugin installation state. claude.ai connectors (Gmail, Calendar, Linear and
  the rest) come with his account and are enabled too.

Never the credential file. A snapshot runs with hooks disabled (they are scripts
that can write anywhere) and `autoDreamEnabled: false`. Memory writes land in the
copy, which is deleted when the attempt ends, so writes are effectively off.

`live` runs in his real `~/.claude` exactly as he does: `CLAUDE_CONFIG_DIR` is
left unset, his settings, hooks, skills and plugins load, and whatever the run
writes (session transcripts, memory, edits under bypassed permissions) stays.
With memory on, `autoMemoryDirectory` points at the same home-directory memory a
snapshot copies, so a live run reads and may write his real memory. Its receipt
notes the digest of his setup at the start, but a live Dish never groups by it:
the run itself may have changed what it measured.

Both personal environments load only the user setting source and exclude
instruction files in the workspace's ancestors through `claudeMdExcludes`,
because the Kitchen's `AGENTS.md` (and any above the checkout) would otherwise
load as project memory.

The toggles map to Claude Code as follows:

| Toggle | On | Off |
| --- | --- | --- |
| memory | `autoMemoryDirectory` at the copied (snapshot) or real (live) home memory | `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and `autoMemoryEnabled: false`: no memory read or written |
| connections | snapshot: copied servers via `--mcp-config` without `--strict-mcp-config`, plus claude.ai connectors; live: his config as it is | empty MCP set under `--strict-mcp-config`, claude.ai connectors disabled, and in live each of his enabled plugins switched off |

Verification compares Claude Code's own `system/init` event with the request:
permission mode `bypassPermissions`, the attempt workspace as `cwd`, exactly the
requested built-in tools, and with connections off no MCP server or `mcp__`
tool. The MCP servers and plugins it reports are recorded in `observed.json` and,
by name, in the Dish receipt.

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
preloaded skill reaches the model.

A snapshot attempt copies a named profile (`rose`) into the same kind of
throwaway home, read from the root Kitchen names (`TASTE_HERMES_ROOT`, default
`~/.hermes`), so the copy and the identity reader share one root: `SOUL.md`
(bytes, not the link), `.no-bundled-skills`, `skills/`, and with memory on
`memories/MEMORY.md` and `USER.md`. Its `config.yaml` is written from an
allowlist of the profile's: the pinned route and model, `memory.memory_enabled`
and `user_profile_enabled` from the toggle (with his character limits, and no
external memory provider), `skills.auto_load`, and with connections on his
`mcp_servers` and `plugins` (and `plugins/` itself). Secrets helpers, fallback
providers, reasoning overrides, platforms, gateways, cron and display settings
stay behind, as do `auth.json`, `.env`, sessions and the profile's `state.db`.
With connections on, each copied server's `mcp-<name>` toolset joins
`file,terminal`; plugin hooks run but plugin toolsets are not added. The run
never selects a profile (`-p`) and keeps the copied soul (no `--ignore-rules`).
Kitchen never runs a Hermes profile live: a live run would record itself in
rose's own sessions and run its plugin hooks against his real channels.

| Toggle | On | Off |
| --- | --- | --- |
| memory | `memories/` copied; memory and user profile enabled | nothing copied; `memory_enabled` and `user_profile_enabled` false |
| connections | `mcp_servers`, `plugins` and `plugins/` copied; `mcp-<server>` toolsets added | none of them; `-t file,terminal` |

Both environments use the committed Hermes environment's own entry point,
because the `hermes` launcher would build a new dependency environment for an
unfamiliar home. Hermes borrows the Claude Code login from
`~/.claude/.credentials.json` (a refresh is written back there). When the
attempt ends, however it ends, the runner empties the Hermes home of everything
but `state.db` (and its WAL files), so a copied login, the soul and the memories
do not outlive it; an allowlist of what stays covers credential files a later
Hermes might add. A Hermes child inherits only `PATH`, `HOME`, `USER`, `LOGNAME`,
`SHELL`, locale, `TERM`, `TZ`, `TMPDIR`, `XDG_RUNTIME_DIR` and
`CLAUDE_CONFIG_DIR` from the Kitchen's environment, so no Gemini, AWS, GitHub or
future provider key reaches it. Both environments write an empty
`.git` marker beside the workspace: Hermes reads every AGENTS.md from the git
root down, and attempts live inside the Kitchen checkout. That placement still
shows: Hermes finds Kitchen's `package.json` within six levels and gives every
run its coding posture (a system-prompt block about editing, tests and git),
and the working-directory path names the Recipe and configuration.
