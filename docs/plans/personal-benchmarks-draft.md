# Personal benchmark directions

Status: working authoring record. Both journal fixtures and seven Recipes are approved and implemented; see `docs/journal-recipes.md` for current catalog scope. Other candidates remain proposals.

## Settled direction

- Recipes are manually shaped personal benchmarks: tasks Burooj wants to compare models on.
- The historical archive supplies categories, provocations, and provenance. Its names and prompt contracts are not authoritative and should not be lightly polished into the public Book.
- The active release is a visual, UI, and design surface. Several Recipes prescribe interactive behavior and currently carry `ux-interaction` metadata, but that does not establish an intentionally authored UX benchmark surface. The metadata should be reviewed against authoring intent when UX Recipes are shaped.
- Multi-turn work is a benchmark dimension in its own right. The Kitchen should make it possible to compare a one-shot task with a staged version of materially the same task.
- The currently affirmed non-visual areas are: responding to journal material, supportive reflection, editing rough prose for public reading, and regrouping sentences without rewriting. Other archived or previously proposed Recipes remain undecided.
- Work under `BJsWorkspace/Labs/` is another source of tasks Burooj may genuinely want to compare. Like the archive, it supplies lived provenance and working materials, not automatically approved Recipes.

## Paired benchmark: developer portfolio

### Question

What changes when the same model builds the same person's portfolio from one complete instruction versus through a staged collaboration?

### Constants

- Maya Chen's existing fictional content packet.
- The final website deliverable and allowed local files.
- Required content, factual boundaries, project filtering, accessibility, responsive behavior, and browser probes.
- Execution configuration and validation contract.

### One-shot sibling

The existing `standard-developer-portfolio` Recipe: read the complete packet and build the site in one turn.

### Multi-turn sibling

The complete facts and final constraints remain available from the start. The fixed collaboration protocol changes:

1. **Read and frame:** identify the visitor, content hierarchy, and visual premise; do not build.
2. **Plan:** turn that premise into a concrete page and interaction plan; do not build.
3. **Build:** implement the complete portfolio without replacing the chosen premise with a new generic direction.
4. **Review and repair:** inspect the implementation against the supplied content, mobile behavior, accessibility, and interaction contract; make bounded repairs while preserving the direction.

The two siblings belong in one paired Menu. They are not Repeats and should not be described as the same Recipe Revision, because the collaboration protocol differs. The multi-turn Dish must preserve the intermediate framing, plan, and review alongside the final runnable site; this may require a Kitchen presentation addition.

## Benchmark: respond to a journal entry

### Question

How does a model receive, interpret, and talk with a piece of lived writing? The object of taste is the response's language and movement—not whether the model can generate a journal question.

### Input choices

- **Synthetic:** an authored journal entry designed to retain ambiguity, voice, metaphor, conflicting pulls, and something that resists immediate resolution.
- **Authentic-derived:** a minimal excerpt or reconstruction from Burooj's private history. The raw source stays private, and the exact sanitized fixture requires Burooj's approval before public cooking.

These may eventually become separate sibling Recipes using the same response prompt. Synthetic and authentic-derived inputs should not be presented as the same Recipe Revision.

### Initial response contract

Give the model the journal entry and ask it to respond as a thoughtful conversation partner. Do not prescribe a therapeutic format, mandatory question, summary, or action plan. The benchmark should leave enough room to reveal what the model naturally notices and how it speaks.

Mechanical acceptance can prove only that every model received the same approved fixture and prompt and that the complete exchange was captured safely. Human tasting considers specificity, prose, warmth, honesty, interpretive pressure, metaphor, restraint, unwanted diagnosis or productivity capture, and whether the response opens the thought rather than merely summarizing it.

## Still to shape manually

- Whether journal comparisons need staged siblings after the first one-turn tasting.
- Whether editing rough prose produces editorial notes, a revised piece, or a staged combination of both.
- Whether regrouping sentences is only a direct lossless control or also deserves a staged sibling.
- The next reflective or creative task after the approved journal comparisons.

## Accepted short journal comparison

Burooj approved the following exact public fixture and two response Recipes in this conversation. Preserve the word "through" as supplied.

> Why does it feel like my coming of age story never finishes through. Is never done. I'm never there. When it does feel like I'm there it feels temporary. Just a bit till it's back

The two one-turn contracts are:

1. **Respond to a journal entry:** "Read the journal entry below and respond to it as a thoughtful conversation partner."
2. **Respond supportively to a journal entry:** "Read the journal entry below and respond supportively. Attend to what feels difficult, leave room for uncertainty, and help the writer feel accompanied."

Both use the same fixture and capture the complete response. Their purpose is to compare response style and interpretation with different requested stances. Lineage is Mother's, from Burooj's journal practice. Kitchen presents the source and exchange; acceptance establishes identical inputs and complete capture, while response quality remains human taste. No mandatory question or response template is part of these prompts. A third, challenging response Recipe was subsequently added; all three have accepted Luna Dishes.

The short entry remains alongside a longer journal comparison. Burooj separately approved the exact larger passage for public use on September 11, 2026. Previous assistant annotations are excluded from both comparisons.

## Accepted Recipe: analyze and extract a brain dump

Burooj explicitly requested this additional task family. Proposed opening instruction:

> Read this brain dump and help me make sense of it. Draw out what seems worth returning to and organize it usefully. Ground your reading in the text, distinguish your interpretation from what I actually said, and preserve uncertainty. Do not turn every thought into a task.

Astra Low independently recommended this less prescriptive wording: the model chooses what matters and how to organize it. Exact quotation extraction would be a separate task; supporting quotations are useful here without requiring every extracted item to be verbatim.

Use a substantial authentic passage with mixed material and unfinished thinking. Prior assistant annotations are excluded. Historical requests inside the passage are source material for analysis; this Recipe grants no authority to execute them or access external systems.

The proposed first version is one turn, with a readable analysis and organized extraction as its deliverable. It would reveal selection, grouping, inference, useful structure, omissions, and overinterpretation. Mother's lineage comes from Burooj's actual brain dumps and Brain work. Mechanical acceptance can check source identity, complete output and exact quotations if used; it cannot certify semantic completeness or sound interpretation.

The same approved long passage supports open, supportive, challenging and extraction Recipes in the `long-journal-responses` Menu. Their authoring checkpoint is complete and all four definitions are in the catalog. Prose editing and lossless regrouping remain separate unresolved tasks.

## UX remains unauthored

The active web Recipes mainly ask models to express and implement supplied product, content, and interaction requirements. That can reveal interaction execution, but it does not cleanly taste UX work such as framing a user problem, choosing among competing flows, interpreting usability evidence, or revising an interaction model.

Candidate UX conversations, not proposed Recipes yet:

- Design an interruption-and-recovery model for one fixed multi-step task.
- Diagnose an existing flow from a small usability evidence packet, then revise it without redesigning unrelated visual language.
- Develop two materially different interaction models for one workflow, choose one with reasons, and carry it into a testable prototype.
- Turn one real Lab workflow, such as editorial proof review or a provenance-rich Living Note, into an operator experience without flattening its domain distinctions.

The first UX authoring conversation should decide which of these is work Burooj would actually return to, and whether the desired comparison concerns research interpretation, interaction-model judgment, adaptation after feedback, or implementation feel.

## Lab-derived benchmark territories

These are bounded families suggested by real work. They are not accepted Recipes and should not become a coverage quota.

### 3D Lab

- Build a small procedural scene from a fixed brief and reference packet, delivering editable scene source plus fixed-camera renders.
- Revise a scene after inspecting a contact sheet while preserving named composition, geometry, and camera invariants.
- Treat dimensioned CAD, photogrammetric reconstruction, and attractive scene rendering as different truth contracts. Renderer setup, installation, conversion, and private-capture intake are equipment tests unless Burooj explicitly wants to compare agents doing them.

### Content Pipeline

- Edit a musing for public reading under a fixed authority boundary: preserve the authored recognition and voice while making only the agreed degree of change.
- Develop an image-and-text candidate from a sanitized Assignment Packet, keeping factual, privacy, accessibility, and authorship boundaries visible.
- Decide what a source may responsibly become before producing public copy. Keep this bounded; an end-to-end newsroom or publishing run introduces too many roles and external authorities for one clean Recipe.

### Music Workspace

- Arrange a short supplied melody or motif into an editable production and a truthful rendered mix.
- Revise an arrangement after listening, preserving the seed while changing a named musical dimension such as harmony, space, groove, or restraint.
- Keep actual composition and production distinct from building a musical interface. The Kitchen should supply playback; DAW harness acceptance, manifest validation, and renderer reliability are infrastructure unless they are deliberately the object of taste.

### Brain Digestion and Undertext

The current source is the chronological Source Digestion model in `Labs/undertext-wiki/CONTEXT.md`, not the superseded topic-first charter.

- Find exact Glints in one mixed Source while preserving wording, context, authorship, and provenance.
- Follow one idea across a small chronological packet, recognizing continuity, contradiction, and genuine change without forcing a predetermined topic.
- Write Undertext beside a fixed authored passage without replacing, summarizing away, or silently converting commentary into source evidence.
- Keep these as separate judgments. A full Brain swarm or end-to-end Digestion Cycle would confound extraction, routing, threading, orchestration, and interpretive writing.

## Strong next authoring conversations

1. Settle the exact authority and deliverable for editing a musing for public reading.
2. Separate immediate response to a journal entry from sustained Undertext written beside authored material.
3. Choose a short musical seed worth hearing several models arrange, plus the listening and editability contract.
4. Choose one genuinely UX-centered task rather than treating interactive web implementation as UX coverage.
5. Choose a small 3D subject worth building and revising from fixed views.

For each, deterministic acceptance can prove faithful inputs, valid and complete outputs, preserved hard constraints, and a usable Kitchen presentation. It cannot certify good prose, insight, music, visual taste, or UX judgment.
