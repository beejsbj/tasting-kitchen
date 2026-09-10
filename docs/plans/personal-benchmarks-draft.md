# Personal benchmark directions

Status: working draft for Burooj's review. This is not an approved Menu or an implementation brief.

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

- What supportive reflection should hold constant, and how it differs from the broader journal-response benchmark.
- Whether editing rough prose produces editorial notes, a revised piece, or a staged combination of both.
- Whether regrouping sentences is only a direct lossless control or also deserves a staged sibling.
- Which journal source should be used first and whether its Dish belongs on the public site.

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
