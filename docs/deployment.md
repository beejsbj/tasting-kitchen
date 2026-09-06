# Serve and maintain the Kitchen

The public Kitchen is a static site. Cooking, raw evidence, provenance and the agent API stay on the owner's machine. The image contains only `dist/` and the web server; it has no model credentials or execution service.

## Build and inspect

```bash
npm ci
npm test
npm run lint
npm run preview -- --host 127.0.0.1

docker build -t tasting-kitchen:visual-v1 .
docker run --rm --network none tasting-kitchen:visual-v1 nginx -t
```

For the browser regression suite, start `npm run dev -- --host 127.0.0.1 --port 5177` in another terminal, then run `npm run test:browser`. It uses installed Chrome at `/usr/bin/google-chrome`; override `CHROME_PATH` or `TASTE_BROWSER_URL` as needed. Set `TASTE_BROWSER_SCREENSHOTS` to an evidence directory to save screenshots. The test uses intercepted sample data for missing Menu cells and Repeats; it never adds Dishes to the catalog.

The Docker build pins its Node and Nginx base images by digest. Update those pins deliberately when maintaining the release. Port `8080` serves the gallery; `/healthz` returns `ok`. The image has a healthcheck. No persistent runtime volume or environment variable is required for the public site.

`npm run build` regenerates the public registry, writes the active public Recipe Book to `public/data/recipe-book.json`, and stages accepted public artifacts and exact input snapshots before Vite builds. The sidecar contains active public source text only; it contains no secrets. Do not copy `catalog/`, `private/`, the repository root, or raw attempts into a webroot. The Docker context excludes private data and local environment files.

During local Vite development, `GET /api/recipes` exposes the current active catalog and same-origin `PATCH /api/recipes/:id` accepts an `expectedHash` and validated updates. Production has no mutation API. The browser can keep drafts or download edits; a hosted save requires the owner's in-memory fine-grained GitHub token and commits directly to `VITE_RECIPE_BRANCH` (default `main`) with one atomic, non-force conflict-checked commit. It sends the token only to `api.github.com` and never runs a model.

The root path is canonical. `TASTE_BASE_PATH=/model-tasting/ npm run build` prepares an alternative subpath build for a webroot already configured to serve that prefix; the included Docker/Nginx configuration serves the canonical root path.

## Artifact hosting contract

`deploy/nginx.conf` is part of the presentation contract. Artifacts run with scripts and forms permitted inside an opaque-origin sandbox. The same sandbox applies when an artifact is opened directly. Forms cannot submit externally. Local JavaScript modules and fetches use anonymous CORS; `/dishes/` responses therefore include `Access-Control-Allow-Origin: *`. Do not add `allow-same-origin` to make a broken module work.

Remote runtime resources are outside the static web profile. Content Security Policy permits local content and inline artifact scripts/styles, while the publication scanner separately checks for remote dependencies and private material. Fixture URLs preserve file types for input previews. Missing artifact, fixture and asset files return 404 rather than the application shell.

The registry and HTML revalidate; hashed application assets can be cached indefinitely. Dish IDs and revision hashes identify immutable content. A recipe edit requires a fresh cook to appear as a new public revision.

## Canonical deployment

Target: `https://tasting-kitchen.burooj.dev/`, public, dedicated Coolify resource. Retain the historical proof at `https://artifacts.burooj.dev/model-tasting/` until the canonical route is proven. A local build does not deploy either site.

The September 5 preflight found canonical HTTPS reaching Cloudflare with valid TLS but returning 503. The existing wildcard ingress covers the hostname. Authenticated Coolify inventory remains unverified because the documented credential source did not contain a usable key. Do not create a token or alter shared routes as a workaround.

Follow Cockpit's `handbook/bjslab/runbooks/coolify-deployments.md` and network operating pipeline for the live operation. Record the approved public exposure, current backup, exact image digest, resource UUID, route pre-state and rollback before promotion. The private source repository is `beejsbj/tasting-kitchen`; choose the authorized image/source delivery path during that preflight.

Prove the new origin and `/healthz`, canonical HTTPS without ignoring TLS errors, the registry, one artifact of every represented output kind, input previews, and desktop/phone comparison. Confirm the old proof and neighboring artifact routes still work. Roll back by disabling only the new resource/route or restoring its previous image digest; the proof remains available throughout.

## Maintenance state

Add a Recipe or model configuration when it answers a useful question. Dry-plan, inspect, cook with explicit intent, run validation, rebuild and promote a new image. Preserve old accepted Dishes and their executed revisions. Keep failed attempts private and add human/agent observations as hash-bound reviews.

The owner Cook UI, authentication/job service and additional harnesses are separate later releases. They are not prerequisites for operating this static gallery with the local CLI/API.

## Vercel review previews

`vercel.json` configures the source build and preserves the artifact sandbox/CORS headers. `.vercelignore` excludes private evidence, environment files and local working material from CLI source uploads. The Vercel project is `beejsbjs-projects/tasting-kitchen`.

The private [GitHub repository](https://github.com/beejsbj/tasting-kitchen) is connected to the Vercel project. [PR #1](https://github.com/beejsbj/tasting-kitchen/pull/1) contains the visual Kitchen implementation.

The current [Recipe Book preview](https://tasting-kitchen-q1fel6fss-beejsbjs-projects.vercel.app/?view=recipes) was deployed September 6, 2026 from application commit `6f07ceb` for [PR #2](https://github.com/beejsbj/tasting-kitchen/pull/2). It contains ten active, uncooked Recipes and an empty Dishes gallery. The 54-recipe archive includes the three original cooked recipes; their 15 historical Dishes remain stored in the repository and are excluded from this deployment. Hosted edits target `work/recipe-book`. This is a review Preview, not a production promotion. The [earlier preview](https://tasting-kitchen-ollk9h7bv-beejsbjs-projects.vercel.app) remains available with its old build.

Automatic Git deployments currently stop before building with `COMMIT_AUTHOR_REQUIRED`: Vercel cannot find a GitHub account for the commit author. A CLI source deployment carrying that Git identity is blocked for the same reason. The account association must be resolved before automatic PR previews work.

The review preview was deployed through the authenticated owner account using the already-built static output. To repeat that route, set `VITE_RECIPE_BRANCH=work/recipe-book` for a review build, build the desired commit, copy only `dist/` into a clean staging directory, and give that directory its own empty Git boundary to prevent ancestor-repository inference. Link it to the existing `tasting-kitchen` project. Its static `vercel.json` sets `framework`, `buildCommand` and `installCommand` to null while retaining the source configuration's artifact and data headers. Deploy with `vercel deploy --target preview --yes`, and record the source commit and URL in the PR. Never copy credentials, the source repository, or private evidence into that directory.

Vercel serves the review surface; the existing homelab proof and canonical Coolify deployment state are unchanged.
