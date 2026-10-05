# Script execution scope

- `build.cjs`, `testing/integration.ts`, `database/*`: local build, disposable integration DB, migrations.
- `evaluation/evaluate.ts`, `evaluation/customs.ts`: offline fixture evaluation.
- `diagnostics/probe.ts`, `verification/*`, `experiments/*`, other capture/review scripts: explicit external requests, browser use or paid model calls may occur. Do not run as part of the offline test suite.
- `evaluation/expand-samples.ts` is a historical maintenance script requiring `docs/evidence/rakuten-ranking-candidates-2026-09-22.json` and `docs/evidence/sazo-sample-discovery-2026-09-22.json`. These original capture inputs are intentionally excluded. The committed fixture manifest is the reproducible regression input.

Generated captures/logs must be reviewed and sanitized before publication. Never commit authentication context or full private pages.
