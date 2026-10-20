# BETA RELEASE READINESS - v0.9.0-beta.1

Date: 2026-10-18. Branch: `main`. Spec: SPC-115 (`01_PLAYWRIGHT_RUN_DIFF_MASTER_SPEC.md`).

## A. Final verdict

**READY FOR PUBLIC BETA** - readiness score **9/10**.

All beta-blocking work is complete and independently verified. Remaining items are either (a) external actions requiring owner authorization (push, deploy, publish, tag) or (b) honest documented limitations, not defects.

## B. Verified features

| Feature | Evidence |
| --- | --- |
| Two-run trace comparison (actions, timing, network, console, visual) | golden CLI tests; `compare` on 8 real fixture pairs + 2 failed-step traces |
| Anchored sequence alignment + manual pair/unpair | `matcher` tests incl. overrides + 600/620-action regression test |
| Version-aware adapters (1.60.0, 1.64.1; context.tracing + @playwright/test) | `real-fixtures.test.ts` (25 tests), `docs/trace-compatibility.md` |
| Multi-stream archives (test.trace + N-trace.*) with run picker | `test-runner*` fixtures; `Landing.tsx` RunPicker; `--before-run/--after-run` |
| Multi-run aggregates (median/p90/IQR, honest sample counts) | `aggregate.ts`, 14 tests incl. N=1/2/3/10/30, small-sample warning |
| Screenshot diff + interactive masks | `visual.ts`, `VisualView.tsx` mask mode, e2e visual step |
| Virtualized action/network tables | `apps/web/src/virtual.ts` |
| Worker cancellation (terminate+restart) | `workerClient.ts` |
| Sanitized JSON/MD/self-contained HTML export + JSON reimport | `report` package, Zod-validated import, report tests |
| CLI exit codes 0/1/2/3, --fail-on, --config, --no-visual, --max-size-mb, --json | verified manually + golden tests |
| Local-only processing | zero external requests observed during full session (page.on('request')) |
| ZIP security (traversal, split, duplicates, ratio, size caps) | `zip.ts`/`limits.ts` + adversarial tests; 400 MiB archive rejected pre-inflate |

## C. Test results

| Check | Command | Result |
| --- | --- | --- |
| Deps | `pnpm install --frozen-lockfile` | clean |
| Types | `pnpm -r typecheck` | 7/7 projects PASS |
| Lint | `pnpm lint` | clean (0 errors) |
| Tests | `pnpm -r test` | **66/66 PASS** (trace-reader 25, matcher 10, analysis 20, report 4, cli 7) |
| Build | `pnpm -r build` | 7/7 PASS (one cosmetic Tailwind sourcemap warning) |
| Browser E2E | `E2E_BROWSER={chromium,firefox,webkit} node scripts/e2e-web.mjs` | PASS x3 (landing, sample compare, dashboard, actions, network, visual, settings) |
| Security audit | `pnpm audit --audit-level=high` | no known vulnerabilities |
| Performance | `node --expose-gc scripts/bench-large.mjs` | 110 MiB / 40k actions: parse ~0.4s, compare ~4.2s, RSS +256 MiB; 400 MiB rejected pre-inflate |
| Packaging | `pnpm pack` x6 + clean-dir `npm install` + run | all tarballs contain only dist+LICENSE+README; `run-diff` executes correctly (12 findings on sample-a) |
| CLI exit codes | manual | invalid zip=2, bad args=2, threshold breach=1, clean run=0 |

Trace producer coverage: `context.tracing` on Chromium/Firefox/WebKit @1.64.1 + Chromium @1.60.0; `@playwright/test` on all three engines @1.64.1; expected-fail assertion traces included.

## D. Remaining issues

**BETA BLOCKER** - none internal.

**STABLE v1.0 REQUIREMENT**
- npm publish, GitHub v-tag, public demo deployment (awaiting authorization; all artifacts verified ready).
- Formal WCAG 2.2 AA audit pass (practical checks done: keyboard nav, focus order, aria-live, labelled drop zones, reduced-motion, no horizontal overflow at 390px; a professional audit pass remains).
- Streaming/incremental ZIP decompression for >150 MiB archives.

**POST-RELEASE IMPROVEMENT**
- Non-JS SDK producer fixtures (Python/.NET/Java traces) - currently fall back to tolerant adapter labeled `partial`.
- `SOURCEMAP_BROKEN` build warning from the Tailwind Vite plugin.
- Screenshot-content credential detection (currently documented limitation - pixels are never scrubbed).
- Fuzz corpus expansion for the ZIP reader.

## E. Release artifacts

- Packages (packed, verified in clean dir): `@sanestly/run-diff`, `@sanestly/contracts`, `@sanestly/trace-reader`, `@sanestly/matcher`, `@sanestly/analysis`, `@sanestly/report` - all `0.9.0-beta.1`, bin `run-diff` + `sanestly-run-diff`.
- Docs: README (with real screenshots + GIF), PRIVACY, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, LICENSE (MIT), CHANGELOG, docs/{architecture,trace-compatibility,report-schema,cli}.md, docs/release/{FINAL_AUDIT,PERFORMANCE,v0.9.0-beta.1,BETA_RELEASE_READINESS}.md.
- Media: `docs/media/` - landing, dashboard (light+dark), actions, network, visual, export, mobile, og-preview.png, demo.gif (7 real frames, 373 KB).
- Deployment: `.github/workflows/demo.yml` (GitHub Pages, relative base), CSP meta shipped in index.html.
- Commits this session: `cc546d8` (correctness+fixtures), `de849e5` (release prep). Prior: `aaba7d0`, `bf68288`, `15f07ce`.

## F. Publication checklist (all require owner authorization)

```bash
# 1. Push repository (create public repo first if needed)
git remote add origin git@github.com:sanestly/playwright-run-diff.git
git push -u origin main

# 2. Enable GitHub Actions - ci.yml runs on push; demo.yml deploys Pages
#    (repo Settings > Pages > source: GitHub Actions)

# 3. Publish packages (order matters - deps first)
cd packages/contracts && pnpm publish --access public --tag beta && cd ../..
# repeat for trace-reader, matcher, analysis, report, then apps/cli

# 4. Create GitHub release
gh release create v0.9.0-beta.1 --prerelease --notes-file docs/release/v0.9.0-beta.1.md

# 5. Verify
npx @sanestly/run-diff@0.9.0-beta.1 --version
# open the Pages URL, click "Try sample traces", confirm dashboard renders
# check https://github.com/sanestly/playwright-run-diff social preview uses docs/media/og-preview.png
```

Post-publish verification: `pnpm audit`, one fresh `npm i -g` smoke test, Pages CSP headers, sample-trace compare in the deployed app.
