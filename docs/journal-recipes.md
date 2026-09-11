# Journal comparisons

Three new one-turn Recipes use the same approved short journal passage:

- `respond-to-short-journal`: thoughtful conversational response.
- `support-short-journal`: explicitly supportive response.
- `challenge-short-journal`: question assumptions or framing with reasons and uncertainty.

The Menu is `short-journal-responses`. The complete passage is embedded identically in each prompt. Setup and output limits are shared. The runner owns the session artifact and the existing session viewer presents it by output kind; no new presentation runtime is needed.

Required checks verify Recipe identity, the exact delivered prompt, one captured turn and a nonempty response. Tests exercise missing, duplicated, empty and mismatched captures. Interpretation, warmth, useful disagreement, and prose remain human judgments. The configured harness does not enforce tool denial; the conversational task requests no external actions.

The `long-journal-responses` Menu contains four further Recipes using one identical longer entry, approved for public use on September 11, 2026:

- `respond-to-long-journal`: thoughtful conversational response.
- `support-long-journal`: supportive response.
- `challenge-long-journal`: question assumptions or framing.
- `analyze-brain-dump`: identify what is worth returning to, organize it usefully, and distinguish interpretation from source statements.

The approved longer passage is preserved without further edits. Previous AI annotations and orientation prompts are excluded. Historical requests within the entry are material for the task, not authorization to perform actions. The same capture checks apply to all seven Recipes; tests also verify identical source text within each Menu.
