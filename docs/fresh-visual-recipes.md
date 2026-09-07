# Fresh visual recipes

Four active identities in [Fresh Visual UI](../catalog/menus/fresh-visual-ui.json). Each is `ready` because its dependency-free Node validator and `static-web-v1` presentation contract are supported. Each has one prompt, `semanticRuntime: null`, and one accepted `codex-luna-xhigh` Dish requested at extra-high reasoning on the default service tier. Acceptance records the recipe validators and publication checks; it is not an independent human visual verdict.

| Recipe ID / title | Original subject and what it reveals | Inputs and unsolved work |
| --- | --- | --- |
| [`fresh-product-span` / Span](../catalog/recipes/ui-visual/fresh-product-span/recipe.json) | A folding laundry rack. Reveals product hierarchy, honest representation and clarity through selection. | Product dimensions, capacity, finishes, stock, prices, accessory, delivery, repair, policies and FAQ. Create the visual page, live estimate, replaceable local bag and validated inquiry preview. No supplied design or checkout. |
| [`fresh-editorial-second-life` / A Second Life for the Moon](../catalog/recipes/ui-visual/fresh-editorial-second-life/recipe.json) | A theatre-materials depot. Reveals editorial pacing across a complete argument and the treatment of modest data. | Seven sections / 21 paragraphs, publication metadata, original quotations, two explanatory notes, optional illustration captions and six ledger rows. Compose the full feature, section/note navigation and seasonal ledger. All reporting is explicitly fictional. |
| [`fresh-interaction-paper-echo` / Paper Echo](../catalog/recipes/ui-visual/fresh-interaction-paper-echo/recipe.json) | An eight-beat call reflected into a response. Reveals expressive interaction, state legibility and the relationship between gesture and form. | Three pattern presets, short copy, transformation rules, playback timing and canonical URL-fragment contract. Create the object, editing, one-shot playback, cancellation, reset and share/reopen behavior. No drawing, lottery or chance selection. |
| [`fresh-system-hem` / Hem Estimates](../catalog/recipes/ui-visual/fresh-system-hem/recipe.json) | A garment-repair desk. Reveals continuity and judgment when a real existing language acquires a workflow. | Original tokens, styled DOM primitives, working queue/detail/material/specimen contexts, three jobs and a rate catalog. Add per-job estimate drafts, line editing, totals, local approval and approval invalidation, plus new specimens. The estimate view and logic are intentionally absent. |

Each brief explicitly lists every required output path. All four require `index.html`, `styles.css`, `app.mjs`, `logic.mjs` and their local `data/*.json` files. Hem also lists its five required `source/*` files and `CHANGES.md`; its three root source files and four baseline source files are mounted editable. Hem's new estimate view must import the real primitive and quote modules. All factual JSON, briefs and mounted validators are immutable. Optional authored assets remain local. The first three recipes leave the visual language open; Hem supplies a language to continue without prescribing the missing estimate composition.

## Checks and evidence

The four validators check nonempty required files, JavaScript syntax, literal local import/resource references, immutable data hashes and **368 pure-API vectors**: Span 43, editorial 7, Paper Echo 302, Hem 16. They import the candidate's actual `logic.mjs`. Vectors cover money and stock boundaries, inquiry errors, seasonal aggregation, reflection and fragment validation, playback boundaries, estimate quantities and input mutation. Shared mechanics are copied into each recipe so every fixture packet is self-contained.

Literal-reference inspection is a mechanical wiring check, not a JavaScript dependency parser or proof that the app calls a function. Computed fetch/import URLs do not satisfy the declared reference checks; use the explicit local references described in each brief. It does not execute DOM events, verify rendered article completeness, or establish accessibility, timer cancellation, bag state or estimate approval. Those are named browser probes. Human inspection also considers hierarchy, sustained reading, expressive character and continuity at 360px and 1440px; no numerical taste judgment is automated.

Verification performed:

- Catalog validation passes after adding four ignored provenance records.
- All 36 validator self-tests pass, including the actual mounted command against temporary positive shells and rejection of wrong answers, missing exceptions, mutated arguments, absent output, syntax errors, disconnected imports, altered snapshots and unavailable packages. Positive shells use explicit lookup doubles; they are validator tests, not solved recipes or taste evidence, and are deleted afterward.
- Scoped ESLint passes for the four recipe directories.
- Fresh menu dry planning supports exactly these four IDs for all six configured model configurations; no model execution or revision freezing is involved.
- Hem's separate baseline browser smoke test exercises its supplied queue, all three detail/back paths, materials, specimen action, disabled state, main focus, loaded token styles and narrow-screen overflow. This checks only supplied behavior; the missing estimate workflow still needs to be authored and inspected.

Reproduce from the repository root:

```sh
npm run validate:catalog
node --test catalog/recipes/ui-visual/fresh-*/validator.test.mjs
node --test catalog/recipes/ui-visual/fresh-system-hem/baseline.test.mjs
./node_modules/.bin/eslint catalog/recipes/ui-visual/fresh-product-span catalog/recipes/ui-visual/fresh-editorial-second-life catalog/recipes/ui-visual/fresh-interaction-paper-echo catalog/recipes/ui-visual/fresh-system-hem
node bin/taste.mjs plan --menu fresh-visual-ui --config codex-sol-high --json
```

The optional baseline smoke test uses the repository's installed Playwright and system Chrome. Cooked validation requires only Node built-ins; no dependency was added.

## Source boundaries

All subjects, facts, copy, quotations, patterns, code and Hem's system were newly authored. No old brief, brand, fixture or source variant was adapted. The recipe schema, product model, catalog/runtime code, menu shape and one small existing output validator were consulted solely for contracts. Private provenance is confined to the four new IDs and is ignored by Git.

The four definitions and supporting packets remain the active menu inputs. The September 6 cook froze their exact revisions and published one accepted Luna XHigh Dish for each; the immutable Dish manifests and traces carry the execution evidence.
