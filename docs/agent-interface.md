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
- `discoverModels({ harness: "hermes", route?, free? })` lists every route Hermes
  is set up for (authenticated, logged out with the fixing command, exhausted,
  retired) and each route's models, free ones marked, with context size and the
  efforts a model takes where known. It reads Hermes's caches and an allowlist of
  auth.json fields (sources such as `env:OPENROUTER_API_KEY`, never a key), and
  OpenRouter's public model list. `taste models [--route ID] [--free] [--json]`.
- `plan` and `cook` also take a configuration spec or selector as
  `configurationId` (`hermes:openrouter/<model>@<effort>[:clean]`,
  `hermes:openrouter/*@auto+free`), with `upstream` naming the OpenRouter
  provider when the choice is not settled by the maker or a sole provider. A
  spec's plan carries `configurationSpec` beside the usual fields; a selector's
  returns `{ configurationSpec, plans }` and its Cook `{ configurationSpec, cooks }`.
  An executed Cook materializes new configurations into the catalog first.
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

Every environment runs with:

- only `Bash`, `Edit`, `Glob`, `Grep`, `Read` and `Write`, plus `Skill` in
  `snapshot` and `live` (no web, subagent or scheduling tools). Network access
  through the shell is not blocked;
- auto-update off;

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
  edits count); **untracked files in such a repository are skipped**, so a skill
  not yet committed reads like a plain folder, and a new file in a committed
  skill is not copied until it is tracked. Others contribute every regular file
  minus `.git`. At any depth, volatile files (`__pycache__`, `*.pyc`,
  `node_modules`, `.staging`, `.last-complete-round`, `.DS_Store`) and
  credential-looking files (`.env`, `.env.*` other than examples, `auth.json`,
  `credentials.json`, `.credentials.json`, `.netrc`, `*.pem`, `*.key`, `id_rsa*`,
  `id_ed25519*`), and links that point at one, are left out, so Claude Code resyncing his account skills or
  Python compiling a script cannot change the setup digest, and a stray secret
  never enters a snapshot. A script keeps its owner exec bit (it is part of the
  digest). A skill such
  as `cockpit` is a whole repository with chat logs beside it, and copying the
  directory would turn one attempt into gigabytes. A snapshot is capped at 5,000
  files and 64 MiB across all of it, counted as files are read, and fails clearly
  beyond that;
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
snapshot copies, so a live run reads and may write his real memory: **live with
memory on keeps its writes in his real home-directory memory**. That is what
live means, and the receipt says so ("Live · writes to your real memory").
`TASTE_CLAUDE_MEMORY_SOURCE` moves both the snapshot's source and the live
target. Live configurations ship with connections off and are labelled "Live ·
connections off"; a live connections-on configuration is not in the catalog yet.
Its receipt notes the digest of his setup at the start, but a live Dish never
groups by it: the run itself may have changed what it measured.

An interrupted cook (SIGINT or SIGTERM) kills the harness's process group,
deletes the copied setup, and records the attempt as failed at stage
`interrupted`. A SIGKILL cannot be caught: its home stays in the cook directory
until someone removes it.

Both personal environments load only the user setting source. The workspace has
no ancestor instruction files to exclude (see "Where cooking happens").

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
`~/.claude/.credentials.json` (a refresh is written back there, so a Hermes
attempt that crosses the token's expiry rotates the login his own sessions use:
the one place a Kitchen run can write to his real `~/.claude`). When the
attempt ends, however it ends, the runner empties the Hermes home of everything
but `state.db` (and its WAL files), so a copied login and the copied files do not
outlive it; an allowlist of what stays covers credential files a later Hermes
might add. `state.db` itself stays, because identity verification and recovery
read it, and Hermes stores each session's system prompt there: a snapshot run's
soul and memory blocks therefore remain in the cook directory's `state.db`
(outside the repo, never published) until someone removes the directory. A Hermes child inherits only `PATH`, `HOME`, `USER`, `LOGNAME`,
`SHELL`, locale, `TERM`, `TZ`, `TMPDIR`, `XDG_RUNTIME_DIR` and
`CLAUDE_CONFIG_DIR` from the Kitchen's environment, so no Gemini, AWS, GitHub or
future provider key reaches it. Hermes reads every AGENTS.md from the git root
down and gives a run its coding posture when it finds a `package.json` within
six levels; the runtime-root guard keeps both out of a cook directory's
ancestry.
