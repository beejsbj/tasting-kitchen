# October Kitchen closeout

This closes the implementation handoff from the September Recipe-planning and issue-lookup sessions and the October animation/layer consultation. Production promotion remains a separate tracked step; a code review or merged PR is not deployment evidence.

## Included work

- Optional workspace skills and prompt-delivered public souls, with exact layer identity and per-layer coverage.
- Dish input and configuration/skill sidecars in place of the frozen revision stores. Existing Dish manifests remain unchanged.
- Historical Dish links, artifact playback and catalog-change disclosures survive edits to current configurations, skills and Recipe requirements.
- Public Recipe Book exclusion for private Recipes, including Ready definitions and their public-marked fixtures.
- Recovery retains and verifies the original layer and prompt; unverifiable or ambiguous legacy layered attempts fail closed.
- Previously local Jev observations and their optional gallery UI. Synthetic rubric replay remains explicitly separate from genuine human evidence.
- Public-checkout tests and PR CI, with strict private-provenance validation still available separately.

The release presents 17 approved Recipes and 27 existing accepted Dishes (20 visual and seven journal). Ten animation drafts remain unaccepted and uncookable. No new model Cook or evaluator execution was performed for this closeout.

## Compatibility

Offering layers at the default mount does not change existing unlayered Recipe hashes. A custom mount path changes the Recipe hash, including for unlayered results, because it changes the execution contract. Skill delivery and entry changes move the skill hash. Older layered attempts whose recorded hashes omit those settings cannot be recovered under the new identity.

## Verification

The full public-checkout suite passed on the portable queue: 109 Kitchen tests, 66 Recipe tests, 29 gallery tests, typecheck, production build and lint. Job: `rj-20261021-084738-5ac29d`.

After the local-vote preview correction, all 31 gallery tests, typecheck, production build, lint and desktop/phone browser verification passed in job `rj-20261021-085018-30dd32`. This includes historical artifact playback and explicitly local vote persistence. Both queue jobs completed with sandbox deletion verified. Private provenance was not exported; strict validation behavior is covered using synthetic records. No new authoring acceptance is inferred from public validation.

The PR review corrections preserve historical artifact kinds across Recipe edits while continuing to reject current-hash kind mismatches, changed artifact bytes/tree hashes and changed Dish manifests. Strict owner validation now checks private accepted Dishes too. Registry construction verifies saved public input bytes; skill receipts reproduce their immutable skill hash. Current-hash workspace mounts are checked against the current Recipe contract; historical mount paths are checked for containment but cannot be independently authenticated from the skill hash alone because mount paths belong to Recipe identity.

Observation corrections bind evidence to the Dish manifest, scan public observation strings for leaks, reject invalid confidence in rubric experiments and scope disagreement notices to each rubric/context. The portable full run passed 158 Kitchen tests, 66 Recipe tests, 31 gallery tests, typecheck and production build (`rj-20261021-145235-eb788f`). That run found one unused test variable in lint, subsequently corrected; the lint rerun is recorded in the PR review receipt. Strict-mode regressions use synthetic provenance and private Dishes; no private evidence was exported.

## Remaining work

- [Deploy the reviewed release](https://github.com/beejsbj/tasting-kitchen/issues/4).
- [Verify the historical automatic PR-preview blocker](https://github.com/beejsbj/tasting-kitchen/issues/5).
- [Collect genuine human evidence before rubric promotion](https://github.com/beejsbj/tasting-kitchen/issues/6).
- [Select animation drafts and complete readiness for the accepted subset](https://github.com/beejsbj/tasting-kitchen/issues/7).
- [Choose a first useful skill or soul comparison](https://github.com/beejsbj/tasting-kitchen/issues/8).
- [Choose the next personal benchmark to author](https://github.com/beejsbj/tasting-kitchen/issues/9).
- [Scope the future owner-only Cook lifecycle and controls](https://github.com/beejsbj/tasting-kitchen/issues/10).

These issues retain the relevant Linear references; this closeout does not claim to have changed Linear state or completed the broader Animation Lab review (BJS-537).

## Preserved source branches

`skill-layers` at `4811413` retains the original implementation checkpoint. The closeout fixes live on `closeout/kitchen-layers`.

The original animation branches, `feat/animation-skill-recipes` at `665b56f` and `feat/animation-style-recipes` at `26ca6f6`, remain available locally; their reshaped disabled drafts are included in the closeout branch. The separate `jev-recipes-20260920` branch at `e5a1efb` remains local and outside this PR: its contestant fixtures/labels are not accepted, and its missing contestant integration is recorded in issue #9.
