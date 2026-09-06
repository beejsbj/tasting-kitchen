# Optional skills in a Cook

Status: proposal for discussion, 2026-09-06. This document does not add CLI flags, configuration fields, skill loading, or new Dishes.

A Recipe defines the work and its acceptance contract. A skill provides reusable guidance about how to approach work. Both can contain text, but a skill may also have referenced documents, scripts, templates, assets, and tool requirements. Treating it as only a pasted prompt loses those dependencies.

Keep optional skills separate from the Recipe so the same task can be tasted with different guidance. Start with no added skill and one explicitly selected skill. For example, cook the same product-page revision with the same model, effort, harness and tier under no added skill, frontend-design, and web-animation-design. This explores guidance effects. Holding one skill constant across models explores model differences under that guidance. A combination of skills is another condition, not a substitute for either individual condition.

## Proposed execution contract

- Resolve selected skills before execution into immutable bundles: exact SKILL.md bytes, required local references and assets, provenance, and a content digest. Fail planning for missing dependencies or unsupported tool/runtime requirements. Do not resolve a moving Git branch during the model run.
- Record an ordered skill selection and its loading mode in the exact requested configuration. Include bundle digests and the guidance-injection contract in the configuration hash; preserve bundles with its executed revision. Different selections, versions, order, or loading modes must not become Repeats of one another.
- Make selection explicit. A baseline means no optional skills supplied by Kitchen; it does not mean the model has no other instructions. Keep the remaining harness instructions fixed and disclose them. Prevent ambient host skills from quietly changing a run; the current fresh Codex home alone should not be assumed to prove every ambient discovery path is disabled.
- Start with explicit guidance injection: supply the selected main document as run guidance and mount its local references at stable paths. Describe this as supplied guidance, not a claim that a provider's native skill loader activated it. A future native-loading mode is a distinct condition.
- Preserve the Recipe's task, fixed facts, fixture boundaries and output contract. Optional guidance cannot authorize tools or alter those requirements. Record the wrapper and precedence rules as execution-affecting input. Preserve the original skill rather than silently rewriting opinionated or inconvenient instructions; adaptations need their own identity and explanation.
- Record what was supplied and, where observable, which reference files/tools were accessed. Access is evidence of access, not proof the model followed the guidance. Human tasting assesses the resulting work.

The supplied web-animation-design skill illustrates why this matters: SKILL.md links to PRACTICAL-TIPS.md and contains both animation guidance and conversational/review instructions. A selected package should retain that context and its dependencies. A textual selection does not automatically make Framer Motion, React Spring, or a browser tool available in the execution environment.

## Proposed interface

The agent API/CLI should discover and inspect local skill bundles, report skill compatibility during dry planning, and accept explicit selection at Cook time. No flag syntax is implemented yet. Missing or incompatible skills should produce an unsupported cell or actionable planning error, never a silent baseline run.

The gallery should retain Recipe as its main organization. Show concise skill chips alongside model/effort on Dishes and permit guidance filtering when there is data to browse. Put full source/version/digest and loading details in the receipt. Existing model cards should not need a separate Recipe for every skill combination.

Initially support one skill at a time plus the baseline. Multiple skills can follow once the independent conditions are useful; their order and interaction must remain visible. Avoid introducing another Kitchen metaphor or a second Recipe catalog for skill combinations.

## What works today

The current Recipe fixture mechanism can preserve skill text and its supporting files as fixed inputs, with an explicit instruction to read them. That makes the guidance part of the Recipe Revision and requires a distinct revision/variant for each guidance condition. It is sufficient for a one-off authored experiment, but it does not provide optional skill selection, native activation, skill facets, or configuration-level skill identity.

The recommended next implementation is configuration-level optional guidance, including snapshotting, hashing, planning, execution, recovery and receipts together. Adding only a prompt suffix or a cosmetic skill badge would allow misleading Repeat and comparison claims.
