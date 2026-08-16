# Deployment status

Checked 2026-08-16.

## Current proof deployment

- `https://artifacts.burooj.dev/model-tasting/` is healthy.
- It is served by an unmanaged Docker Compose Nginx sidecar at `/mnt/server-ssd/services/model-tasting` on the artifact service's Traefik network.
- It is not currently a Coolify resource.

## Canonical hostname

- `tasting-kitchen.burooj.dev` already reaches the public Cloudflare wildcard and local Traefik.
- No matching application route exists yet, so the hostname safely returns `503`.
- No Cloudflare ingress change is needed for the initial launch.

## Deployment gates

1. Finish the recipe-first/root-path work selected for the first canonical release.
2. Establish an authorized Git remote for this repository. Creating or pushing that remote requires explicit approval.
3. Restore an approved Coolify credential path; this headless shell has no `COOLIFY_KEY`.
4. Triage the current bjslab deployment-preflight failures before changing the routing boundary.
5. Create a dedicated Coolify resource with `npm ci`, `npm run build`, publish directory `dist`, HTTPS, and a `/` health check.
6. Verify the registry and at least one immutable dish through both public Cloudflare and forced-local Traefik paths.
7. Keep the proof URL healthy until rollback and cutover are documented.

The private Cook worker requires persistent volumes for jobs and accepted dishes. Provider credentials must be mounted only into that worker and must never appear in the frontend image or public artifacts.
