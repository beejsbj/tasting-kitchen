# Historical investigation method

## Boundary

This is a one-time analysis of Burooj's encounters with AI, not a continuing profile. The fixed source cutoff is **2026-08-13**. Nothing after that date belongs in the evidence base, and no watcher or ingestion job was created.

The object of study is interactional: what Burooj asked a model to do, what move the model made, how he corrected or continued it, and what eventually became useful. It is not a general personality analysis. Raw journals and notes were inventoried only as possible context; they were not treated as model encounters by themselves.

## Sampling frame

The inventory found 218 structured Codex and Claude sessions before the cutoff, containing 3,073 parsed user turns, plus 460 prompt-history rows that extend the observable range back to February 2026. Structured sessions were the primary source. Prompt histories filled early or missing-session gaps. Project artifacts were used only when a session showed that an output was reused, tested, deployed, or otherwise continued.

Sampling was signal-led rather than exhaustive. I prioritized:

1. correction, rejection, redirection, clarification, interruption, and takeover;
2. accepted outputs and later continuation;
3. development, infrastructure, and UI/UX work;
4. personal-assistant, research, ideation, writing, and reflective uses;
5. different months, model surfaces, task lengths, and apparent success levels.

Keyword tags helped locate candidates, but no tag was accepted as a finding without reading the surrounding interaction. Duplicate, resumed, and replayed sessions were treated as one episode, not independent corroboration.

## Review depth and saturation

Fifty-four structured sessions and 48 prompt-history rows received qualitative review. Twenty-seven bounded episodes were retained in the private ledger. The sample covers ordinary troubleshooting, long agentic implementation, UI iteration, research, assistant operations, writing/instruction work, ideation, reflective preparation, historical synthesis, and a multimodal transformation pilot.

After the major evidenced use areas had been sampled, two additional varied batches were reviewed:

- an earlier prompt-history batch spanning February and March, including UI, configuration, research, and corrections;
- a low-signal cross-month batch spanning operations, UI state, multilingual audio, merge work, and storage cleanup.

Neither produced an important new use category. The second added one narrower variant—pilot a multilingual audio transformation before scaling—but it fit the existing transformation-and-verification pattern. This met the stop condition. Coverage percentage was not used as a reason to continue.

## Evidence grades

- **Recurring evidence**: the move appears in multiple independent episodes or materially different task settings.
- **Plausible hypothesis**: the pattern has more than a stray hint, but the evidence is narrow, indirect, or concentrated in one context.
- **One-off**: a useful real encounter that should not be generalized as a stable taste.

Evidence IDs in tracked files are abstract. Exact local paths and source locators exist only in the gitignored ledger.

## Privacy procedure

- Source material was read in place and not modified.
- No raw transcript, journal entry, credential, private third-party detail, or identifying excerpt was copied into tracked files.
- Tracked findings use paraphrase and structurally equivalent scenarios.
- Exact paths, local session identifiers, and audit scripts remain under `private/`.
- High-stakes reflective material is described only by task shape, not personal substance.
- Findings were checked for local paths, URLs, credential-like strings, names of private third parties, and transcript-like passages before handoff.

## Interpretation limits

The source base is heavily weighted toward technical and agentic work. Claude's structured local history begins in July even though prompt history reaches February, so response-side evidence is thinner in the earliest period. Ordinary calendar/email assistance, standalone creative writing, and direct journal dialogue are underrepresented. Explicit praise is also an imperfect success signal; continued use, live verification, and durable artifacts carry more weight here.

