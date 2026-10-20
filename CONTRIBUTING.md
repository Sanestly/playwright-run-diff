# Contributing

Thanks for helping improve Playwright Run Diff.

## Setup

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm dev:web
```

Node >= 20 (`.node-version` pins LTS), pnpm >= 9.

## Ground rules

- TypeScript `strict`; no new `any` without a comment explaining why.
- Commits must be authored as `Sanestly <dev@sanestly.com>` - CI rejects other identities. `.githooks/pre-commit` blocks them locally too (enable once per clone: `git config core.hooksPath .githooks`).
- Trace content is untrusted: sanitize before rendering or exporting, and never expand limits without a documented reason.
- Never mark a capability as supported without a code path that actually produces it - report `absent`/`unsupported` instead.
- Deterministic output matters: same archives + same settings must produce identical reports.
- Run `pnpm -r typecheck` and `pnpm -r test` before opening a PR.

## Fixtures

`fixtures/generated/` contains real chromium traces produced by `scripts/generate-fixtures.mjs`. Do not hand-edit trace zips; adjust the generator and regenerate. Document the producing Playwright version in `fixtures/generated/MANIFEST.json`.

## Report schema changes

`packages/contracts` defines schemaVersion `1.0`. Breaking changes require a new major schema version plus a clear migration error in `parseComparisonReport`.

## Pull requests

- Keep PRs focused; describe the user-visible behavior change.
- Add/adjust tests for parser, matcher or rule changes.
- Do not commit secrets, real-world traces with customer data, or fabricated metrics.
