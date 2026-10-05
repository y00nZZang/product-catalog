# Container deployment

Use `deploy/compose.yaml` behind Caddy, with a private environment file outside the checkout. Set domain, image RELEASE_TAG, database credentials and provider keys. `bootstrap.sh` provisions a Linux Docker host; review it before running. The local `compose.yaml` is the easiest starting point.

Build from the repository root, run migrations, replace API/worker, then verify `/api/health`. Preserve database and Caddy volumes. This repository does not deploy automatically. Credentials and production cloud account/VM identifiers are excluded.
