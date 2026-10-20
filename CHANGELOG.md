# Changelog

All notable changes to this project are documented here. Format follows Keep a Changelog; versioning is semver.

## [0.9.0-beta.1] - 2026-10-18

### Added

- Initial implementation: monorepo with `@sanestly/contracts`, `trace-reader`, `matcher`, `analysis`, `report` packages.
- Firefox and WebKit `context.tracing` fixtures plus `@playwright/test` runner fixtures for all three engines; cross-browser E2E (chromium/firefox/webkit).
- Large-archive benchmark (`scripts/bench-large.mjs`) and `docs/release/PERFORMANCE.md`.
- Small-sample warnings on aggregate timing findings; N=1..30 coverage in stats tests.
- Real screenshots, demo GIF and social-preview image under `docs/media/`.
- `run-diff --version` / `-v` now works as a bare command.
- `run-diff` CLI: `compare` and `inspect`, `--format json,md,html`, `--fail-on` thresholds, exit codes 0/1/2/3, config file support.
- React web explorer: import wizard, dashboard, action/network/console/visual views, sanitized export, dark/light themes.
- Real chromium trace fixtures (Playwright 1.64.1) with reproducible generator script.
- Second-version fixtures (playwright-core 1.60.0, `resources/` screencast layout) and `@playwright/test` multi-stream fixtures (`test-runner/`).
- Playwright Test runner support: `test.trace`/`N-trace.*` streams exposed as selectable runs; `method:"expect"` detected as assertions; `params.locator` selectors.
- Multi-run aggregate statistics (median, p90, IQR) via comma-separated archives per CLI side.
- Web UI: run picker for multi-stream archives, interactive screenshot masks, virtualized action/network tables, open saved report, skip-link/live-region a11y.
- Real cancellation: compare can be aborted by restarting the worker.
- ZIP security guard, URL/secret redaction, deterministic sanitized report schema v1.0.

### Fixed

- Matcher crash on ~40k-action traces (V8 max Map size) - removed a redundant similarity cache.
- Archive-level browser no longer blank for test-runner archives (empty `browserName` on `test.trace` no longer overwrites the context stream's value).
- Visual diffs under ~2% demoted to `info` severity with a JPEG-screencast-noise caveat (identical Firefox runs no longer produce medium noise findings).
- Trace `log` events (internal action logs) no longer counted as browser console events - removed ~11 false console findings on real fixtures.
- Matcher: mismatched neighbors no longer veto a strong action match after inserted blocks (long sequences no longer split valid pairs).
- Malformed JSONL line previews no longer propagated into warnings/reports (possible secret leak).
- npm packaging: publishable metadata, `files` whitelist, license, per-package READMEs; renamed CLI package to `@sanestly/run-diff`.
