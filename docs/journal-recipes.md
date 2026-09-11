# Journal comparisons

Three new one-turn Recipes use the same approved short journal passage:

- `respond-to-short-journal`: thoughtful conversational response.
- `support-short-journal`: explicitly supportive response.
- `challenge-short-journal`: question assumptions or framing with reasons and uncertainty.

The Menu is `short-journal-responses`. The complete passage is embedded identically in each prompt. Setup and output limits are shared. The runner owns the session artifact and the existing session viewer presents it by output kind; no new presentation runtime is needed.

Required checks verify Recipe identity, the exact delivered prompt, one captured turn and a nonempty response. Tests exercise missing, duplicated, empty and mismatched captures. Interpretation, warmth, useful disagreement, and prose remain human judgments. The configured harness does not enforce tool denial; the conversational task requests no external actions.

Four additional long-entry definitions are prepared in ignored private authoring storage: open response, support, challenge, and brain-dump analysis/extraction. Their exact larger passage awaits approval for public use. Previous AI annotations are excluded. These drafts have not been promoted to the catalog.
