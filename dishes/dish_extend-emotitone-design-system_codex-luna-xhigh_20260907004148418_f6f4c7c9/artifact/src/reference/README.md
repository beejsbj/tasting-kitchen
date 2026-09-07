# Emotitone Solfrege source fixture

This fixture vendors a small, useful public-source slice from `beejsbj/emotitone-solfrege` at commit `4cb0fdc513c60f0affd7e3cf3a1302a78af082ab` (the resolved `main` SHA when this recipe was authored). The byte-identical upstream files are under `fixtures/upstream/`; `source-provenance.json` records their upstream paths, commit, and SHA-256 digests, and the validator checks the published copies without network access.

The selected files are deliberately connected to the recipe:

- `style.css` supplies the dark color variables, custom font intent, touch-sized `.btn-solfege` controls, and motion conventions.
- `AppHeader.vue` supplies the compact centered Emotitone title and labeled MIDI indicator states.
- `OverlayPanelShell.vue` supplies the dark layered, clipped-corner panel with header, toolbar, body, and footer boundaries.
- `IconButton.vue` supplies the small slanted control geometry and restrained tone variants.
- `Tabs.vue`, `TabsList.vue`, `TabsTrigger.vue`, and `TabsContent.vue` establish the shared selected-tab family that the local browser adapter continues.
- `solfege.ts` supplies the movable-do interval identities and the Major/Minor data used by the bounded local mode samples.

These are source references, not runnable static dependencies. They require the upstream Vue 3 runtime, TypeScript handling, alias resolution (such as `@/`), Tailwind processing, and, for the configured font, an upstream local asset. The recipe does not vendor packages, the font binary, audio libraries, browser MIDI permission, or a build tool. `static-tabs.js` is an authored vanilla-browser adaptation of the Tabs family, and `mode-samples.js` is an authored bounded data port of the source’s exported Major and Minor solfege arrays. They are local runtime inputs, and neither is a byte-identical upstream source.

To port a cooked result back to the app, replace the static adapter with the upstream `Tabs` components, import the source data through the app's TypeScript aliases, move Degree Lens into a Vue component, and let the repository's existing Vite/Tailwind/font pipeline build it. Keep the local feature state owned by that component; it does not establish a new shared extraction.
