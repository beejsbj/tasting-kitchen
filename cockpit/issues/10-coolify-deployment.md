# Deploy Tasting Kitchen through Coolify

Status: Ready for agent

Labels: `executor:codex`, `site:bjslab`

## Goal

Make `https://tasting-kitchen.burooj.dev/` the canonical, health-checked deployment through Coolify.

## Context

The proof gallery currently lives at `https://artifacts.burooj.dev/model-tasting/` through a separate Nginx sidecar. The canonical app needs root-path configuration and persistent runtime storage before cutover.

## Done when

- gallery base URL and runtime data roots are configurable;
- deployable services have health checks and least-privilege runtime configuration;
- job manifests, accepted dishes, and required runtime evidence use backed-up persistent volumes;
- the public gallery and authenticated private control boundary are verified;
- Coolify serves the canonical domain with valid TLS;
- build, deploy, smoke-test, rollback, and recovery steps are documented;
- existing artifact routes remain healthy during verification;
- a separate explicit decision records whether the old URL redirects, archives, or remains available.

## Constraints

- Do not retire or overwrite the old proof deployment as part of the initial launch.
- Never bake provider credentials into images or frontend assets.
- Depend on issue 04 for a gallery-only launch; depend on issues 07–08 before enabling Cook in production.
