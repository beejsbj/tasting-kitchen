# Serve and maintain the Kitchen

The public Kitchen is a static site. Cooking, raw evidence, provenance and the agent API stay on the owner's machine. The image contains only `dist/` and the web server; it has no model credentials or execution service.

## Build and inspect

```bash
npm ci
npm test # validates the public checkout; private provenance is not required
npm run lint
npm run preview -- --host 127.0.0.1

docker build -t tasting-kitchen:visual-v1 .
docker run --rm --network none tasting-kitchen:visual-v1 nginx -t
```

On the owner checkout, `npm run validate:catalog` also requires and validates the ignored private provenance records. Keep those records private; `npm test` uses `validate:catalog:public` and explicitly reports that it does not establish provenance completeness.

On bjslab, run finite verification through `cockpit resources run --profile portable -- <command>` (or `portable-browser` for the browser suite).

For the browser regression suite, start `npm run dev -- --host 127.0.0.1 --port 5177` in another terminal, then run `npm run test:browser`. It uses installed Chrome at `/usr/bin/google-chrome`; override `CHROME_PATH` or `TASTE_BROWSER_URL` as needed. Set `TASTE_BROWSER_SCREENSHOTS` to an evidence directory to save screenshots. The test uses intercepted sample data for missing Menu cells and Repeats; it never adds Dishes to the catalog.

The Docker build pins its Node and Nginx base images by digest. Update those pins deliberately when maintaining the release. Port `8080` serves the gallery; `/healthz` returns `ok`. The image has a healthcheck. No persistent runtime volume or environment variable is required for the public site.

`npm run build` regenerates the public registry, writes the active public Recipe Book to `public/data/recipe-book.json`, and stages accepted public artifacts and exact input snapshots before Vite builds. The sidecar contains active public source text only; it contains no secrets. Do not copy `catalog/`, `private/`, the repository root, or raw attempts into a webroot. The Docker context excludes private data and local environment files.

During local Vite development, `GET /api/recipes` exposes the current active catalog and same-origin `PATCH /api/recipes/:id` accepts an `expectedHash` and validated updates. Production has no mutation API. The browser can keep drafts or download edits; a hosted save requires the owner's in-memory fine-grained GitHub token and commits directly to `VITE_RECIPE_BRANCH` (default `main`) with one atomic, non-force conflict-checked commit. It sends the token only to `api.github.com` and never runs a model.

The root path is canonical. `TASTE_BASE_PATH=/model-tasting/ npm run build` prepares an alternative subpath build for a webroot already configured to serve that prefix; the included Docker/Nginx configuration serves the canonical root path.

## Artifact hosting contract

`deploy/nginx.conf` is part of the presentation contract. Artifacts run with scripts and forms permitted inside an opaque-origin sandbox. The same sandbox applies when an artifact is opened directly. Forms cannot submit externally. Local JavaScript modules and fetches use anonymous CORS; `/dishes/` responses therefore include `Access-Control-Allow-Origin: *`. Do not add `allow-same-origin` to make a broken module work.

Remote runtime resources are outside the static web profile. Content Security Policy permits local content and inline artifact scripts/styles, while the publication scanner separately checks for remote dependencies and private material. Fixture URLs preserve file types for input previews. Missing artifact, fixture and asset files return 404 rather than the application shell.

The registry and HTML revalidate; hashed application assets can be cached indefinitely. Dish IDs identify immutable content. A recipe edit changes its recipe hash; earlier Dishes stay, marked “brief changed since this Dish”, until a fresh cook covers the new hash.

## Canonical deployment

Live: `https://tasting-kitchen.burooj.dev/`, public, dedicated Coolify application `rlh7jvdyrxrsidy9hdwztmgz`, building `main` from its Dockerfile. The canonical deployment was first promoted from commit `d2f9e01` on September 7, 2026; the historical proof at `https://artifacts.burooj.dev/model-tasting/` was then stopped and now returns 404, and its stopped container and files remain available.

The current release is commit `4be01e1`, promoted on November 9, 2026 as Coolify deployment `1vd8rftjcuzec92gsm46hzgw` with image `sha256:ae6dd79e38a9197cdb4659cb1262897562d4eae2e6ee41c4e8869efc1bce9787`. It includes the `.mjs` fix from [PR #36](https://github.com/beejsbj/tasting-kitchen/pull/36), the harness and environment axes, and the later harness work (#26, #42, #44). Its rollback target is `73f2b0d` (image `sha256:f44f6bade862ac35e789748ced049b5465126d7ab469bf23a8053a90ac9086ff`), live from November 8 to 9. That release had already passed the module check; every web Dish ran its JavaScript.

Production checks on `4be01e1` passed for:

- the HTTP-to-HTTPS redirect, and TLS without ignoring errors on the public and local paths;
- the root and `/healthz`;
- the registry (17 Recipes, 27 Dishes, one observation, 67 configurations);
- all 27 Dish entries (20 web, 7 session), all 154 artifact files and 172 public input previews, matched by hash;
- the `/dishes/` sandbox, CORS and `nosniff` headers;
- `.mjs` served as `text/javascript`, with all 14 module-based web Dishes running in a browser without module or page errors;
- the vote API's trusted-network boundary;
- the harness, environment and Compare by controls, with no console errors;
- desktop (1440×900) and phone (390×844) presentation.

The releases before it, both on November 8, were `49772b4` (deployment `g9idrx8ol2zbnv1aqc24gbgh`, image `sha256:990e15a6…`), which still served `.mjs` as `application/octet-stream`, and `73f2b0d` (deployment `s6dpkqo0dla0dbiqgnzrf0q4`). Before them, `83b552f` (image `sha256:8fc7a63b…`) was live from September 7.

The host backup gate in Cockpit's Coolify runbook was not met for these releases. `bjslab-local-backup` fails on a locked SQLite database, and its last successful snapshot is from October 19, 2026. Each promotion therefore went ahead on service-specific copies: the hash-checked vote store and the saved previous image. Cockpit's Tasting Kitchen receipt records the details.

Follow Cockpit's `handbook/bjslab/runbooks/coolify-deployments.md` and network operating pipeline for the live operation. Record the approved public exposure, current backup, exact image digest, resource UUID, route pre-state and rollback before promotion. The public source repository is `beejsbj/tasting-kitchen`; choose the authorized image/source delivery path during that preflight.

For each promotion, prove the new origin and `/healthz`, canonical HTTPS without ignoring TLS errors, the registry, one artifact of every represented output kind, input previews, and desktop/phone comparison. Confirm neighboring artifact routes still work. To roll back, deploy the previous image, not the source. A plain Coolify deploy rebuilds `main` HEAD, so it rolls forward. Coolify keeps recent images as `rlh7jvdyrxrsidy9hdwztmgz:<commit>`. Choose the target commit's image in the application's Rollback view. If that image has been pruned, first `docker load` the saved copy on bjslab, which restores the same tag; Cockpit's receipt records where it is. Alternatively, stop the canonical application; during the initial cutover, the stopped historical proof container can also be restarted from `/mnt/server-ssd/services/model-tasting/compose.yaml`.

## Maintenance state

Add a Recipe or model configuration when it answers a useful question. Dry-plan, inspect, cook with explicit intent, run validation, rebuild and promote a new image. Preserve old accepted Dishes with their `inputs/` and `receipt.json`. Keep failed attempts private and add human/agent observations as hash-bound reviews.

The owner Cook UI, authentication/job service and additional harnesses are separate later releases. They are not prerequisites for operating this static gallery with the local CLI/API.

## Vercel review previews

`vercel.json` configures the source build and preserves the artifact sandbox/CORS headers. `.vercelignore` excludes private evidence, environment files and local working material from CLI source uploads. The Vercel project is `beejsbjs-projects/tasting-kitchen`.

The public [GitHub repository](https://github.com/beejsbj/tasting-kitchen) is connected to the Vercel project. [PR #1](https://github.com/beejsbj/tasting-kitchen/pull/1) contains the visual Kitchen implementation.

The current [Recipe Book preview](https://tasting-kitchen-nssu93tsf-beejsbjs-projects.vercel.app/?view=recipes) was deployed September 6, 2026 from application commit `1d3d195` for merged [PR #2](https://github.com/beejsbj/tasting-kitchen/pull/2). It contains ten active, uncooked Recipes and an empty Dishes gallery. The 54-recipe archive includes the three original cooked recipes; their 15 historical Dishes remain stored in the repository and are excluded from this deployment. Hosted edits target `main`. This remains a review Preview, not a production promotion. The [earlier preview](https://tasting-kitchen-q1fel6fss-beejsbjs-projects.vercel.app) remains available with its prior build.

Automatic PR previews work as of November 8, 2026, and the `COMMIT_AUTHOR_REQUIRED` block does not reproduce. Only [PR #1](https://github.com/beejsbj/tasting-kitchen/pull/1) (`64fe91f`) and [PR #2](https://github.com/beejsbj/tasting-kitchen/pull/2) (`2986ea6`), both September 6, were blocked ("Deployment was blocked"). Every PR head from #3 through #34 built, including PR #11 (`43ad170`, October 21), which is authored and committed as `otto@burooj.dev`, and the open bot-authored PRs. GitHub now links `otto@burooj.dev` to `beejsbj`, even on the two blocked commits. The cause was therefore most likely an account-linking or Vercel-side state that has since changed; it cannot be reproduced from the repository. The PR #28 preview returns the `/dishes/` CORS, `Content-Security-Policy` sandbox and `nosniff` headers from `vercel.json`.

The supported route is to open a PR and read the `Vercel` commit status and the Vercel bot comment for the preview URL. Vercel builds from source with `vercel.json`, so no `dist/` upload is needed. If a preview is blocked again, check the commit author's GitHub association first and use the manual route below as a fallback.

The manual fallback deployed the review preview through the authenticated owner account using the already-built static output. To repeat that route, set `VITE_RECIPE_BRANCH` to the branch that should receive hosted edits, build the desired commit, copy only `dist/` into a clean staging directory, and give that directory its own empty Git boundary to prevent ancestor-repository inference. Link it to the existing `tasting-kitchen` project. Its static `vercel.json` sets `framework`, `buildCommand` and `installCommand` to null while retaining the source configuration's artifact and data headers. Deploy with `vercel deploy --target preview --yes`, and record the source commit and URL in the PR. Never copy credentials, the source repository, or private evidence into that directory.

Vercel serves the review surface; Coolify serves the canonical production site.
