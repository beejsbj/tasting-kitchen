# Model Tasting Kitchen

A personal, reusable menu for learning the feel of raw AI models through encounters Burooj actually cares about.

The project contains three finished layers:

- `analysis/` — a bounded, one-time analysis of historical model encounters;
- `library/` — eight evidence-grounded flights containing 25 dishes;
- `app/` — a manual copy/paste kitchen for running those dishes later and keeping browser-local notes.

It does not call model APIs, rank models, or infer a permanent preference profile.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

## Verify

```bash
node library/validate-library.mjs
npm run lint
npm test
```

`npm test` builds the production site, verifies the rendered kitchen surface, and tests record export/import behavior.

## Use the kitchen

See [How to taste](docs/how-to-taste.md). Saved runs remain in the current browser unless explicitly exported as JSON.

## Add or revise a flight

1. Read `library/flight.schema.json` and an existing flight.
2. Add or revise a public-safe JSON file under `library/flights/`.
3. Keep the model-facing prompt open-ended; place observation lenses and correctness checks in metadata.
4. Update `library/menu.json`.
5. Run `node library/validate-library.mjs` and the full verification commands above.

The evidence behind version one is summarized in `analysis/`. Precise source locations and audit details remain in gitignored `private/` files.

## Scope boundary

Version one ends at assembled flights plus a reusable kitchen. [Future calibration](docs/future-calibration.md) is deliberately documented but not implemented.
