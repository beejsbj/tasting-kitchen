# How to taste

Start with a task you care about. There is no schedule and no need to run every model through every Recipe.

## Explore the counter

Open a Recipe to compare up to three exact configurations. Read the recipe to inspect the instructions and supplied input bytes. Interact with the artifacts, or open one in its own tab for more room. Configuration receipts distinguish what was requested from what the harness actually reported.

The revision selector holds the task constant. Choose the same configuration in two slots, then select different Dishes to compare Repeats. A single output can be a fluke; revisit a result or try a neighboring Recipe before treating an impression as a stable fingerprint.

The Models shelf filters by family, reasoning effort, harness and service tier. A family can contain several configurations. Menus pin a specific revision of every member Recipe and show coverage against that full set; missing cells remain visible. A Menu appears publicly only after every member has an accepted Dish somewhere.

## Cook locally

From the repository root:

```bash
# Discover configurations, Recipes and Menus, then inspect a brief.
node bin/taste.mjs discover --json
node bin/taste.mjs inspect --recipe responsive-product-launch --json

# Inspect work and missing coverage without executing a model.
node bin/taste.mjs cook --menu visual-ui --config codex-sol-high \
  --intent fill-missing --json

# Explicitly execute after reviewing that plan.
TASTE_ALLOW_MODEL_RUNS=1 node bin/taste.mjs cook \
  --menu visual-ui --config codex-sol-high --intent fill-missing --execute --json
```

`fill-missing` reuses accepted results for the exact Recipe Revision and requested configuration. `repeat` creates a new attempt even when that pair already has a Dish. Cooking is dry by default; the execution flag and environment opt-in are both required for paid model runs.

Each Recipe gets a fresh workspace and model session. A multi-turn Recipe resumes only its own session. Known constraints belong in the initial brief; staged feedback belongs only where adaptation itself is the subject. Accepted Dishes are immutable. Failed attempts and raw traces stay private.

See [the agent interface](agent-interface.md) for API imports, complete command semantics and error handling.

## Acceptance and taste

An accepted Dish passed its required checks and the publication boundary. Check descriptions say what was measured; acceptance does not establish overall quality or preference. Manual observations remain separate from structural checks.

Artifact reviews identify their human or agent observer and bind to the exact immutable Dish hash. A model's final message is its own claim, not independent verification.

Notice differences in your own language: what feels careful, clumsy, alive, restrained, useful, or unlike your work. The observation cues are invitations. There is no score or automatic winner.

## Grow at the pace of use

The first release concentrates on four visual and UI task shapes. Other Recipes remain available for later authoring work. Add a neighboring Recipe when it would help answer a real question; the rest of the catalog does not have to be finished first.
