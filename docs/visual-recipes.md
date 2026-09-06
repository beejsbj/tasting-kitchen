# Visual Recipe contracts

The existing `visual-ui` Menu retains four distinct candidates for drafting and inspection. Ready means supported by the execution boundary; it does not mean a model result has been cooked or human-approved.

| Recipe | What it reveals | Supplied input | Expected result and human probes |
| --- | --- | --- | --- |
| `responsive-product-launch` — Product launch page | Familiar product work: persuasion, decision clarity, and visual interpretation of facts. | Latchlight facts, two mounting modes and their limits, battery/runtime/repair information, price and local action behavior. | A complete responsive page. Select each mount and see its price/selection summary; open repair information. Check every fact, hierarchy, readability and compatibility clarity. Palette, type, imagery and comparison layout remain open. |
| `editorial-culture-feature` — Culture feature | Visual authorship across sustained reading, an opening composition and contrasting reading rhythms. | An original fictional feature with thirteen paragraphs, title/dek/byline, attributed pull quote, five chronology entries, source disclosure, and a captioned abstract SVG map. | A full article preserving supplied copy and paragraph order, with map, quote and chronology. Check selectable text, disclosure, caption associations, opening hierarchy and rhythm over the full reading path. The map is content, not a required visual style. |
| `shared-result-ritual` — Shared-result ritual | An expressive interactive object whose anticipation and consequence remain understandable through interruption. | Fictional seed-library event, exact state messages, fixed result and deterministic rehearsal transitions. | Start waiting; Close entries interrupts; Retry verification seals; Begin drawing reveals Entry 18; Reveal entry selects the recipient. Verify guards against early draw/selection, no premature recipient text, reset and repeatability. Inspect live announcements and distinct states with reduced motion. Visual treatment is open. |
| `extend-design-system-without-flattening-it` — Design-system extension | Continuity with an existing language and judgment about shared versus feature-owned work. | Editable token/styles, real primitives, baseline overview/setup/inspection compositions, working local signal selector; immutable brief with four devices, usage evidence and concrete extension behavior. | An importing styleguide with all three contexts, pair/cancel simulation, retained signal interaction, and a promote/prune/keepLocal ledger. Compare source imports/exports with the ledger, inspect continuity, and try controls. The brief fixes existing token roles but does not dictate the new implementation structure. |

Review all four at 390px and 1440px, with keyboard-only operation, visible focus, and no horizontal page overflow. Review reduced motion wherever motion is introduced. These are human probes, not taste scores or claims that automation verified visual quality.

## Execution and source boundaries

All known instructions arrive in one turn, under `static-web-v1` with a null semantic runtime. Each result publishes `index.html` and its allowed local resources. The opaque script-enabled sandbox supplies no same-origin privileges or network dependencies. Copy or embed runtime inputs into published paths: `fixtures/` and `validation/` are working inputs and are not shipped with the Dish.

Factual JSON packets, the original editorial SVG, and validator sources are immutable inputs. Only the design-system sources mounted in `src/` are editable. Their initial bytes still contribute to the exact Recipe Revision. The supplied system is a baseline to extend, not an accepted Dish or a hidden reference answer. Its setup controls deliberately await the extension behavior; its signal selector already works locally. No live equipment, checkout, verification service or drawing service is implied.

## Automatic evidence and its limits

The three general web validators require a nonempty entry and nonempty files within the allowed output paths, and syntax-check external JavaScript modules without executing them. The editorial validator also requires `assets/night-map.svg`; it does not prove the map is displayed or byte-identical. Fidelity is a human probe. Scratch notes outside published paths do not affect these checks.

The system validator requires its entry, stylesheet, styleguide module, original component/feature modules, token sheet and decision ledger. It checks nonempty published files and JavaScript syntax, including nested source modules. The ledger has exactly `promote`, `prune` and `keepLocal`, each with a distinct JavaScript symbol, nonempty reason and contained existing source path. A pruned symbol names the removed shared API; its source names the surviving file from which it was removed. The ledger does not automatically prove imports, exports, implementation or sound architectural judgment.

No validator executes a browser, checks inline-script syntax, resolves every dependency, verifies accessibility, or proves the ritual's state machine. Manual checks are advisory cues in the current runner; an automatic pass is not a recorded human observation and does not gate publication on human approval. A later tasting must actually perform and record those probes beside its Dish. This authoring pass creates no Dishes and supplies no fabricated browser evidence.

## Retained choices and revisions

Retained the four IDs, concise names, existing `visual-ui` membership, lineage, output packaging, immutable/editable fixture distinction, single-turn boundary, editorial map, Latchlight facts and three-way system decision ledger. Those already supported distinct comparisons. Expanded the thin editorial packet and system usage evidence; made the ritual reproducible; specified useful local product actions; removed the product's table prohibition. No palette, typography or animation prescription was added to the open briefs.

Current versions are `2.1.0` for product launch and shared-result ritual, and `1.1.0` for culture feature and design-system extension. These minor bumps identify the changed prompts, source packets and validation contracts; new execution hashes are expected. Existing immutable Recipe snapshots and accepted Dishes remain byte-for-byte unchanged, including the historical `1.0.0` launch and ritual results. Only a separately authorized Cook can freeze and execute these new drafts.

## Extension variants from existing projects

The separate `design-system-extensions` Menu includes the Northstar baseline and three variants. The original four-member `visual-ui` Menu remains the small starting set. Each variant has its own Recipe identity and task; compare models within an exact variant revision. Different supplied systems and extension tasks do not imply equal difficulty or a held-constant comparison across variants.

| Variant | Supplied system and extension |
| --- | --- |
| `extend-conduit-design-system` — Conduit extension | The specified `portfolio/showcase-2025` branch's StyleGuide and selected supporting source. Add a listing-provenance inspector with three selectable local sample states. |
| `extend-qrng-design-system` — QRNG extension | The lottery frontend's actual visual and component language, with an explicitly authored browser starter. Complete ticket count, approval and receipt behavior. The supplied URL's `contracts/` directory contains Solidity infrastructure; the visual reference comes from the adjacent `frontend/`. |
| `extend-emotitone-design-system` — Emotitone extension | The Vue application's instrument-panel styles, clipped panel/control geometry, tabs and movable-do data, with a browser tabs adapter. Add a Major/Minor degree lens that updates the supplied degree attributes. |

Each recipe supplies a bounded local snapshot with a pinned upstream commit, original paths and file digests. The fixture notes identify omitted dependencies and assets. These are authentic source references, not invented replacement design systems or live upstream URLs that can change between models.

The current output contract remains self-contained `static-web-v1`. Source excerpts use their upstream frameworks; the task explicitly adapts the relevant language into browser modules and extends that implementation. It does not claim to test a native React/Vue patch against the complete upstream application. That stronger continuation test would require a prepared dependency/build environment and a separate contract. Fidelity, component reuse and interaction quality remain human review questions.

The new variants are uncooked. They do not appear on the public counter until accepted Dishes exist. Optional reusable skill guidance is discussed separately in [skill-guidance.md](skill-guidance.md); it has not been added to these recipes implicitly.

Authoring verification: all 27 vendored files matched both their recorded SHA-256 digests and bytes fetched from the pinned upstream commits. Each new validator passed a scratch positive case and rejected malformed output; those checks establish mechanical boundaries, not visual quality. Chrome smoke checks exercised the QRNG starter's selection guard, roll, submit and approval callback, and the Emotitone adapter's keyboard tab selection. They do not constitute completed extensions or accepted Dishes. The four-member extension Menu dry-plans with no unsupported cells under `codex-sol-high`.
