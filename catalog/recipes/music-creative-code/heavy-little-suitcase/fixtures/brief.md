# Heavy little suitcase

## Task

Someone small has to get something far too heavy to where it needs to go. The first try fails. The second uses a different strategy and works. That is the whole plot; who, what, where and why are yours.

Two things are being tasted. First, the look: make it graphically striking. Commit to a visual language with a point of view, one a viewer would remember and could not mistake for a default, and hold it through the whole film, including the moments of greatest effort. Second, weight: with the sound off, the viewer should feel how heavy the thing is through motion alone.

Direct it yourself: camera, framing, cuts and pacing are your choices. No captions, dialogue, magical strength or sudden size changes.

## Timing

Make exactly 24 seconds at 1080 × 1920, 24 fps (576 frames). In `evidence.json`, report when each of these visibly happens, in this order: `first-attempt` (the try that fails), `change-of-plan` (the moment the new strategy begins), `success`. Do not turn the film into a sequence of still title cards.

## Working protocol

If a skill directory is mounted at `skill/`, read `skill/SKILL.md` first and follow its planning, implementation and review process; its examples teach technique and must not be submitted. If no skill is mounted, work from this brief and your own method. All required facts and creative constraints are provided now. Work independently in one autonomous authoring turn, including tool use and up to three render/inspect/revise rounds. Do not ask for a concept selection or delegate to another model. Use one render job and one browser at a time. Kitchen must supply an identical pinned toolchain and compute profile to every compared model. Local dependency installation is setup, not access to new film inputs.

Draw every visible element in code, and synthesize original sound. Do not use external images, generated stills, stock footage, sampled music, other model outputs or donor scene implementations. Pinned examples teach the technique; the submitted scene must be newly authored. No network calls at playback. Keep randomness seeded and make the live picture a pure function of time; expose `window.seek(t)` and a readiness promise `window.ready`. Include working play/pause and an explicit user gesture to start sound.

## Deliverable

- `film.mp4`: H.264 with AAC audio, exact dimensions and frame count above.
- `player.html`: self-contained live code animation and synthesized sound, matching the export.
- `index.html`: copy `fixtures/player.html` unchanged; Kitchen supplies the comparison presentation.
- `contact.png`: a labeled contact sheet with at least one frame per required beat.
- `source/`: all authored source, needed engine code and dependency locks.
- `README.md`: the visual idea in two sentences, exact rebuild commands, source attribution and honest checks/limitations.
- `evidence.json`: `beats` array of objects containing `id` and `time` (seconds) for every contract beat; `checks` array containing `name`, `result` (`passed`, `failed` or `not-run`) and `detail`. Report actual checks; unseen playback is not a pass. These are review pointers, not proof that the action looks correct.

Fit the complete delivery within 100 MiB and 500 files. Leave dependency trees, frame caches and provider traces outside it. Run `node validation/film.mjs` from the delivery root with fixtures mounted. Independently inspect complete motion, listen to sound, check the final encoded movie and inspect the native-size or phone-size picture. Record anything unavailable.

## Human tasting

- Would you remember this look? Is it a choice that shapes every frame, or a filter laid over a default?
- Does the style hold during the moments of greatest effort, or break down there?
- With the sound muted, can you feel the weight?
- Is the second attempt a different strategy, and is it staged so you see why it works?

File validation cannot establish these visual qualities.
