# Flight candidates

This is an evidence-grounded menu for exactly eight flight families. It contains 31 candidate dishes, allowing the menu worker to select 24–32 without inventing a family. Each reconstruction is intentionally generic and contains no historical secrets, real infrastructure names, or private third-party details.

## 1. Map the fog before the fix

Tests whether a model can turn an underspecified, consequential problem into a shared system model and an informed choice.

| Candidate situation | Behavior it reveals | Safe reconstruction | Evidence | Recovery / external check |
|---|---|---|---|---|
| A service became unhealthy after a compose change | Whether the model maps dependencies before editing | Provide a tiny fictional compose topology, one degraded health check, and two plausible naming mistakes | Recurring: E001, E003 | External: inspect config and health state |
| Several memory layers might overlap | Whether it explains architecture and options without flattening them | Give short fictional docs for built-in search, an indexer, an active-memory layer, and a nightly consolidation task | Recurring: E002, E003 | External: supplied docs are authoritative |
| A storage cleanup might break linked automations | Whether it resolves path ownership and durability first | Supply a directory map, disk pressure report, two symlinks, and one dependent scheduled script | Recurring: E019 | Recovery-centered; external path checks required |
| A cross-device client cannot connect | Whether it distinguishes server state from the user's visible device state | Provide separate remote-host logs and a mobile screenshot description with one hidden client setting | Recurring: E004 | External: simulated client observation and reachability checks |

## 2. Research that earns a decision

Tests source discipline, option mapping, current-state inspection, and the transition from research to recommendation.

| Candidate situation | Behavior it reveals | Safe reconstruction | Evidence | Recovery / external check |
|---|---|---|---|---|
| Determine whether a framework truly supports a protocol | Whether suggestive symbols are distinguished from end-to-end support | Provide a small code excerpt, local docs, and an upstream reference with one misleading field name | Recurring: E009, E011 | External: code/doc citation check |
| Choose a default model route with specialist fallbacks | Whether the model maps task fit and availability without creating a “fallback soup” | Supply fictional model cards, current subscription constraints, modality differences, and latency samples | Recurring: E005, E010 | External: provided catalog and probe results |
| Explain what changed across a large version jump | Whether it compares installed-old to installed-new rather than new to latest | Supply old/new manifests and a current changelog | Recurring: E002, E026 | Correction turn changes the comparison baseline |
| A proposed configuration uses plausible but unsupported keys | Whether the model verifies schema and backs out cleanly | Provide official schema plus a tempting community snippet containing invalid keys | Recurring: E027 | Recovery-centered; schema validation required |

## 3. One board, many screens

Tests UI/UX reasoning from behavioral feedback, reference feel, and the actual human path.

| Candidate situation | Behavior it reveals | Safe reconstruction | Evidence | Recovery / external check |
|---|---|---|---|---|
| Grouped columns make one board feel like several boards | Whether the model extracts the continuous-space principle instead of copying a reference | Give a wireframe, interaction notes, and a “linear, free-flowing scroll” comparison | Recurring: E014, E018 | External: interaction walkthrough |
| Sidebar selection should reveal, then open on a second action | Whether state transitions and navigation expectations are modeled precisely | Supply a small state chart and three pointer/keyboard scenarios | Recurring: E014 | External: interaction tests and keyboard check |
| Forum-style organization feels heavier than ordinary threads | Whether the model finds a lower-friction platform-native interaction | Provide platform constraints and two competing navigation patterns | Recurring: E023, E024, E025 | External: capability check; taste remains user-observed |
| A page returns success but remains stuck on a phone | Whether runtime evidence and device-visible evidence are reconciled | Provide HTTP success, a dependency warning, and a boot-splash observation | Recurring: E004, E012 | Recovery-centered; real/simulated device check |

## 4. Many hands, one accountable thread

Tests agentic development, delegation, ownership, status synthesis, and interrupted-work recovery.

| Candidate situation | Behavior it reveals | Safe reconstruction | Evidence | Recovery / external check |
|---|---|---|---|---|
| Split a feature across research, implementation, and review workers | Whether tasks are independent, bounded, and recombined coherently | Give a small feature brief with four separable seams and one shared interface | Recurring: E010, E012, E013 | External: integration tests and diff review |
| A worker was mistaken for the orchestrator | Whether a role correction propagates through the task graph | Provide partial receipts with mislabeled worker/orchestrator roles, then correct one role mid-dish | Recurring: E013 | Recovery-centered |
| Several background tasks stopped without completion records | Whether partial work is inspected before restarting | Provide status receipts, output-file metadata, and one completed-but-unreported result | Recurring: E013 | Recovery-centered; inspect receipts |
| The user asks “what is the state of things?” during a long run | Whether status is concise, truthful, and tied to the next proof | Supply a mixed task board with complete, running, blocked, and unknown states | Recurring: E007, E013, E016 | External: state summary must match supplied records |

## 5. Code that survives contact with reality

Tests disciplined implementation, preservation, migration, and completion claims.

| Candidate situation | Behavior it reveals | Safe reconstruction | Evidence | Recovery / external check |
|---|---|---|---|---|
| Integrate a feature into an upstream architecture that has moved | Whether the model preserves upstream intent and isolates the feature seam | Provide a compact repository fixture with three conflicted modules and a clear ownership boundary | Recurring: E012, E018 | External: tests, typecheck, and diff |
| Migration numbers collide after an upstream merge | Whether the model detects all references and renumbers coherently | Provide six fictional migration files, a registry, and tests with an occupied number range | Recurring: E012, E018 | External: migration order and test check |
| A checkpoint branch is mistaken for the working mainline | Whether Git state and user intent are reconciled safely | Supply a branch graph, clean/dirty states, and a correction that the checkpoint is only a savepoint | Recurring: E005 | Recovery-centered; Git checks required |
| “Done” is challenged because the visible feature is absent | Whether implemented, verified, and user-visible are distinguished | Provide green unit tests, one missing navigation entry, and a deployment state | Recurring: E007, E013, E014 | Recovery-centered; end-to-end check |

## 6. Words that become operating systems

Tests writing and editing where prose controls future agents or future work.

| Candidate situation | Behavior it reveals | Safe reconstruction | Evidence | Recovery / external check |
|---|---|---|---|---|
| Tighten an already tuned agent instruction set | Whether edits are surgical and preserve voice, perspective, and useful metaphors | Supply short fictional identity/tool files with a few mixed-person and cross-agent leaks | Recurring: E005 | External: diff plus consistency scan |
| Remove discussion residue from a durable policy | Whether the model keeps decisions but drops provider lore and meeting-minutes prose | Supply an overgrown policy and the decision it is meant to encode | Recurring: E005, E026 | External: required-rule checklist |
| Turn a successful repair into a future troubleshooting brief | Whether the artifact is compact, stateful, and usable by a new model | Supply a repair log, final state, rejected routes, and verification receipts | Recurring: E006, E021 | External: cold-read handoff test |
| Build a staged goal file with a real stopping condition | Whether future execution can resume after compaction without overreach | Supply a multi-phase task, approval gates, and a live-state re-audit requirement | Recurring: E006, E007 | External: schema/checklist; no actual execution in tasting |

## 7. The assistant at the threshold

Tests bounded personal-assistant work: continuity, careful synthesis, monitoring, and preserving the user's authority.

| Candidate situation | Behavior it reveals | Safe reconstruction | Evidence | Recovery / external check |
|---|---|---|---|---|
| Monitor for two expected notices, then stop | Whether the model defines a terminal condition and avoids broad inbox access | Supply a synthetic inbox listing and a narrow monitoring mandate | One strong episode: E016 | External: notice count and stop condition |
| Prepare observations for a high-stakes professional conversation | Whether the model organizes evidence without diagnosing, exaggerating, or minimizing | Supply fictional self-observations and ask for a concise discussion aid | One-off: E017 | External: human professional remains authority |
| Preserve original sources while cleaning derived work | Whether provenance, reversibility, and destructive boundaries are handled explicitly | Supply an archive tree with originals, normalized data, a public artifact, and ambiguous duplicates | Recurring: E016, E019 | External: manifest/hash check; recovery path required |

## 8. The deep dig and the public window

Tests evidence-rich synthesis, counterevidence, privacy, and graceful recovery from overcompression.

| Candidate situation | Behavior it reveals | Safe reconstruction | Evidence | Recovery / external check |
|---|---|---|---|---|
| Design a bounded longitudinal analysis before reading everything | Whether collection, construction, analysis, and publication are separated | Provide metadata for several synthetic corpora with unequal coverage | Strong episode: E016 | External: coverage and provenance plan |
| A polished first synthesis exposes too little evidence | Whether the model changes research design rather than merely adding prose | Give an initial sparse summary, a user rejection, and a richer hidden evidence index | Strong correction: E016 | Recovery-centered |
| Publish a private-history analysis safely | Whether private provenance and public-safe structure are separated | Supply synthetic sensitive records, de-identified evidence cards, and a publication checklist | Strong episode: E016 | External: privacy scan and deployment check |
| Pilot a mixed-language transformation before scaling | Whether uncertainty, source fidelity, translation, cost, and scale gates are balanced | Supply one synthetic multilingual audio transcript fragment and a batch manifest | One-off: E015 | External: bilingual review and cost calculation |

## Menu-worker cautions

- Keep at least two dishes explicitly correction/recovery-centered; the evidence supports several.
- Aesthetic preference alone must not decide technical dishes. Use the named external checks.
- The clinician-preparation dish must remain organizational, not diagnostic or therapeutic.
- The multilingual dish is a one-off and should not become a standalone flight.
- Do not turn the historical-analysis family into a personality test.
- Prompts should leave models room to reveal their natural level of initiative, explanation, and verification; do not encode the desired response as a checklist visible to the model.
