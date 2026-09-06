# Kitchen experience

This is the public browsing contract. The execution contract remains in [product-model.md](product-model.md); local cooking is described in [agent-interface.md](agent-interface.md).

## Intent recovered from the discussions

On August 13, 2026, Burooj described a model tasting kitchen for developing his own intuition about models: “The benchmark doesn't produce numbers. It's for my intuition.” Recipe means the brief; Dish means the artifact. He also asked that the site feel “kitcheny/cooky.” These are product requirements, not decorative permission or a proposal for a leaderboard.

On September 6, he restated the kitchen requirement and rejected the remaining sentence-like titles, filler copy, separate model-browsing tab, and dropdown-heavy interaction. He asked for model filtering on the main page, direct model/thinking pills on recipe cards, and recipe clicks that open the latest creation. These newer instructions govern the public UI.

The exact palette and materials were not previously settled. The implemented treatment is an enamel kitchen: cobalt lettering, porcelain tiles, a steel counter edge and trays around artifacts. A dark restaurant pass and a timber recipe box were considered; enamel keeps a recognizable kitchen setting while leaving generated artifacts legible. This is an implementation choice for visual review, not a recovered user decision.

## Counter and dish navigation

- Recipes are the main browsing surface. Search, model family, and thinking effort filter the same collection. Cuisine and lineage are secondary filters. The old `view=models` address remains an alias for this surface.
- A recipe's preview and title open its newest accepted Dish among the active filters. With no filters, this is the newest accepted Dish for that Recipe. “Newest” sorts by `executedAt`, breaking ties by Dish ID.
- A card's model button opens that family's newest matching Dish. An effort button opens the newest Dish for one exact configuration snapshot. “Thinking” means reasoning effort, not service tier.
- Every direct selection includes Recipe ID, Recipe Revision hash, configuration ID and Dish ID in the URL. Friendly model names never replace exact configuration identity.
- The viewer opens one artifact at full viewport size. A floating toolbar provides Home, Compare, model selection, the recipe sidebar, receipts and direct artifact access. Tailwind styles standard Radix popovers and the right-hand recipe sheet; controls do not reserve a header or footer around the artifact. Compare adds up to two more panes. Model changes stay on the same Recipe Revision; missing output remains missing. Repeated configurations can be compared to inspect Repeats.
- Repeat buttons are ordered by execution time, then Dish ID. Default selection is the newest Repeat. Recipe Revision browsing appears only when more than one cooked revision exists.
- Selection and comparison changes have browser-history entries. Search replaces the current entry. Returning to the counter retains its filters.
- The frozen brief and inputs open in a right-hand sidebar with focus containment, Escape dismissal and focus restoration. Execution receipts open from the toolbar. They do not occupy the main artifact surface by default.

## Names and copy

Current catalog titles and summaries are display metadata. The public counter uses their current concise names, even when the newest accepted Dish used an older brief. Historical Recipe Revision display metadata and execution remain unchanged; opening the brief shows the exact recorded version. Renaming a card must not rewrite an execution hash or an accepted artifact.

Use concrete task names such as “Product launch page” and “Permission ladder.” Copy should identify a task, explain a control, or account for a real empty/error state. Avoid slogans about taste, fingerprints, or instincts that add no information to the current action.

The [Sitegeist gallery](https://sitegeist.kian.im/) and [Which AI](https://www.whichai.dev/) informed result-first navigation and direct configuration/iteration selection. Their scoring and ranking surfaces are not part of this Kitchen's purpose.

## Scope

The public Kitchen remains read-only. The historical suggestion of a floating Cook control does not override the later release boundary: authenticated execution and background jobs are future work. CLI/API cooking is already available locally with explicit execution intent. Adding recipes or running paid model cooks is independent of changing the public design.
