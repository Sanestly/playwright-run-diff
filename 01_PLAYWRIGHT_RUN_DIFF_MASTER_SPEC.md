# Sanestly Playwright Run Diff — MASTER IMPLEMENTATION SPEC

**Document ID:** SOSS-PRD-001  
**Version:** 1.0 / 2026-10-18  
**Intended reader:** autonomous coding agent or senior TypeScript engineer  
**Delivery status:** implementation specification, not an implemented or tested product  
**Target:** complete, public, polished open-source release `v1.0.0`  
**Suggested repo:** `sanestly/playwright-run-diff` (verify availability; do not presume it exists)  
**Suggested URL:** `https://sanestly.com/open-source/playwright-run-diff` with live demo on a static route  
**License target:** MIT for original code; audit every dependency and redistributed fixture

> **Agent mandate.** Implement all P0, P1 and P2 requirements in this document; do not silently downgrade mandatory functionality to a mock, demo-only path, or a backlog item. Create working code, fixtures, tests, docs, CI, release artifacts and a deployable demo. If an upstream trace field/API differs from this spec, test actual captured fixtures, document the adapter and implement a version-aware solution. Do not claim green checks or release readiness unless executed.

## 1. Product definition and competitive boundary

**One-line pitch:** “Compare two Playwright test traces, locate behavioral regressions, and share a reproducible, privacy-aware diff report.”

**Users:** frontend engineers, QA automation engineers, Playwright-heavy teams, CI maintainers. **Core job:** distinguish baseline vs candidate behavior when the test is slow, broken, changed, flaky or visually different.

**What exists:** Playwright Trace Viewer can inspect individual traces, network and screenshots; screenshot snapshot comparisons exist inside Playwright Test. This project must **compare two *independent runs*** and produce meaningful matched-action deltas, not duplicate Trace Viewer. Never claim to be an official Playwright tool.

**User journeys:**
1. Open demo → click “Load sample traces” → immediately inspect a realistic comparison without signing in.
2. Drag `before.zip` and `after.zip` → validation → actionable comparison summary → action alignment → screenshots/network/console/logs.
3. Filter regressions and explain why each was flagged → exclude known harmless differences → export a **sanitized** human report and full machine-readable JSON.
4. Run `run-diff compare ./before.zip ./after.zip --format json --out results/` locally or in CI; fail build only on configured thresholds.
5. Load a saved report in browser without original ZIP (report contains only explicitly included/sanitized data).

**Non-goals:** rerun/execute test code, remote CI account connections, proprietary cloud analysis, automatic AI causality statements, rewriting Playwright's internal Trace Viewer, indefinite compatibility guarantees with undocumented trace layouts.

## 2. Definition of done for the product

`v1.0.0` means all:
- Browser app deployed and usable on Chromium, Firefox and Safari desktop latest supported stable versions, with accessible keyboard navigation and no login.
- Paired trace ingestion, true action matching, performance/network/console/visual diffs, filters, manual overrides, report export/import, CLI and CI examples operational.
- Entire comparison works locally in browser without uploading user trace bytes to Sanestly servers. Hosting remote JS assets still creates normal requests; privacy copy must distinguish this from uploads.
- At least 6 *real Playwright-generated* deterministic trace fixture pairs, documented Playwright versions, reproducible fixture generation, golden comparison assertions, negative security fixtures.
- 0 critical/high outstanding vulnerabilities, test suite green, repeatable build, source maps handled, dependency licenses audited, signed-off release checklist.
- Complete English README, screenshots/GIF, actual demo, API/format docs, troubleshooting, changelog, license, security policy and GitHub Actions workflows.

## 3. Product architecture

### 3.1 Technology and workspace

- TypeScript `strict`, React + Vite, Tailwind (or equivalent consistent tokens), shadcn/ui where license appropriate, Radix primitives, TanStack Query only if actually needed, Zustand/Jotai for ephemeral UI state.
- `pnpm` workspaces with Node LTS pinned using `.node-version` / `engines`. Build/test package versions must be locked. Vitest, Testing Library, Playwright E2E, ESLint, Prettier, `tsc --noEmit`.
- ZIP parser: use `fflate`/JSZip only behind an adapter. JSZip simple for small archives; for large archives prefer worker + bounded, incremental decompression. This is not permission to allocate arbitrarily large ZIPs.
- Screenshots: `pixelmatch` plus canvas/OffscreenCanvas where supported; Web Worker; image decode capability detection and fallback.
- Workspace:

```text
playwright-run-diff/
  apps/web/                 # static SPA, routing, workers, UI
  apps/cli/                 # Node CLI; no SaaS backend
  packages/contracts/       # schemas, public JSON types, versioning
  packages/trace-reader/    # ZIP scanner, version-aware parsers/adapters
  packages/matcher/         # action grouping, alignment, overrides
  packages/analysis/        # timing, network, errors, screenshots
  packages/report/          # deterministic JSON, HTML, markdown
  fixtures/                 # generated/reduced, reviewed for secrets
  scripts/                  # fixture generator, release checks
  docs/                     # architecture, format, limits, FAQ
  .github/workflows/
```

Architecture flow:

```text
before.zip / after.zip
      ↓ local ZIP guard, file classifier, provenance
TraceArchiveReader (Worker / Node adapter)
      ↓ version adapters + diagnostics
NormalizedTrace  × 2
      ↓ test/run selection + action matching
AlignedActions + ManualMappingOverrides
      ↓ analysis workers
DiffFindings + EvidenceRefs + Confidence + Limitations
      ↓                                     ↓
React Explorer                           CLI / JSON / HTML / Markdown
```

No network API or database is required for browser use. CLI runs entirely locally. Browser route `/open-source/playwright-run-diff/` must support configured Vite base path and GitHub Pages/Cloudflare Pages/static hosting fallback (avoid SPA deep-link 404s).

### 3.2 Explicit external compatibility strategy

The Playwright trace ZIP is **not a promised stable third-party interchange standard**. Actual trace archives typically hold `.trace` / `.network` JSONL, possible `.stacks`, metadata and `resources/`, but presence/content change across releases. Implement:
- `ArchiveProbe`: discover filenames (no assumptions about prefix); map multiple trace streams to logical runs.
- `TraceFormatAdapter`: `canParse(probe): ParseConfidence`, `parse(stream): NormalizedTrace`; version-specific adapters tested against real fixtures, a tolerant generic adapter for known event fields and honest `unsupported` fallback.
- `parseWarnings`: unknown event, missing fields, no screenshot, no network trace, no assertion metadata, incompatible timestamps/timebases.
- Preserve original event data only **in memory** and only while session active; never put it in localStorage, telemetry or default report exports.
- `test.step` and Playwright Test assertions may be present only with Playwright Test traces. `browserContext.tracing` alone does not capture assertions; render “Not recorded”, not a made-up pass.

## 4. Contracts (baseline TypeScript models)

Interfaces below define **our normalized output**, not Playwright's wire format.

```ts
type Availability = 'available' | 'absent' | 'unsupported' | 'corrupt';
type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged' | 'unmatched';
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

type FindingCategory =
  | 'action' | 'timing' | 'network' | 'console' | 'error' | 'visual' | 'structure';

interface EvidenceRef {
  kind: 'action' | 'request' | 'frame' | 'resource' | 'console' | 'metadata';
  run: 'before' | 'after';
  id: string;
  offsetMs?: number;
}
interface NormalizedAction {
  id: string;
  testId?: string;
  pageId?: string;
  frameId?: string;
  parentId?: string;
  label: string;
  apiName?: string;
  method?: string;
  locatorFingerprint?: string;
  urlFingerprint?: string;
  source?: { file?: string; line?: number; column?: number };
  startMs: number; endMs?: number;
  status: 'ok' | 'failed' | 'unknown';
  errorSummary?: string;
  screenshotRefs?: string[];
}
interface NormalizedRequest {
  id: string;
  pageId?: string;
  method: string;
  normalizedUrl: string;
  rawUrlAvailable: boolean;
  status?: number;
  resourceType?: string;
  startMs?: number; endMs?: number;
  failureReason?: string;
  transferBytes?: number;
}
interface NormalizedTrace {
  id: string;
  sourceLabel: string;
  recordedVersion?: string;
  browser?: string;
  viewport?: { width: number; height: number };
  timeOrigin?: string;
  actions: NormalizedAction[];
  requests: NormalizedRequest[];
  consoleEvents: Array<{ id: string; level: string; timeMs?: number; text: string }>;
  errors: Array<{ id: string; message: string; source?: string }>;
  capabilities: Record<'actions' | 'requests' | 'screenshots' | 'assertions', Availability>;
  warnings: string[];
}
interface ActionPair {
  beforeId?: string;
  afterId?: string;
  confidence: number;       // 0..1
  matchReason: string[];
  manualOverride?: boolean;
}
interface DiffFinding {
  id: string;
  category: FindingCategory;
  severity: Severity;
  status: DiffStatus;
  title: string;
  details: string;
  evidence: EvidenceRef[];
  confidence: number;
  ruleId: string;
  suppressed?: boolean;
}
interface ComparisonReport {
  schemaVersion: '1.0';
  createdAt: string;
  toolVersion: string;
  before: Omit<NormalizedTrace, 'actions' | 'requests' | 'consoleEvents' | 'errors'>;
  after: Omit<NormalizedTrace, 'actions' | 'requests' | 'consoleEvents' | 'errors'>;
  pairs: ActionPair[];
  findings: DiffFinding[];
  summary: Record<string, number | string | boolean | null>;
  settings: ComparisonSettings;
  limitations: string[];
}
interface ComparisonSettings {
  timing: { minAbsoluteMs: number; minRelativeIncrease: number };
  match: { minimumConfidence: number };
  visuals: { maxPixelDiffRatio: number; maskRects: Array<{x:number;y:number;width:number;height:number}> };
  ignore: { urlPatterns: string[]; actionPatterns: string[]; responseHeaders: string[] };
}
```

Validate report JSON against Zod schema; reject unsupported future major versions with a clear migration message. Never serialize raw cookies, Authorization headers, request bodies or HTML snapshots by default.

## 5. Input, archive security and trace parsing

### 5.1 Accepted files and limits

- `.zip` exported by Playwright tracing/Playwright Test, plus exported `comparison-report.json` for reopen.
- Default input limit: 150 MiB compressed **per archive**, configurable by user up to 300 MiB; 600 MiB aggregate uncompressed cap, 25,000 entries, 20 MiB max JSONL line; adjust caps based on actual browser benchmarks and document hardware assumptions.
- Validate ZIP central directory and magic bytes, not MIME alone; reject encrypted/split ZIPs, zip-slip paths (`..`, absolute paths, drive paths, NUL), symlinks, duplicate normalized entry collisions and excessive compression ratio/zip bombs.
- Detect and communicate out-of-memory risk before decompression; stop worker with cancel and release references. No automatically opening URLs found in trace content.
- Workers report progress phases, bytes and entry counts; UI supports cancellation, retry and discard.

### 5.2 Parser specifics

- Discover all entries; identify `*.trace`, `*.network`, `*.stacks`, `resources/`, source attachments and optional metadata. Some traces have multiple chunks and multiple tests. Let user choose comparable logical run(s).
- Parse JSON Lines with backpressure, isolate malformed lines and attach line-index errors. Fatal only if cannot construct a usable trace; partial data is explicitly labeled.
- Normalize timestamps **within the same run**; do not compare epoch timestamps between runs as duration differences. Clock origin, monotonic time and wall time must not be conflated.
- Distinguish APIs, steps, page frames, attach snapshots, request timing and test metadata. For errors, preserve safe summary and evidence references only; avoid silently dropping unknown event types.
- Lazily load image binary data from `resources/*` only when selected, with lifecycle-managed Object URLs. Provide placeholders if no screenshot was recorded.
- Decode request status, method, path, host, resource type, failure where present. Query values may contain tokens: redact in displayed/exported representations by default.
- Golden fixtures must pin producer Playwright versions and have a checked-in reproducible generator; no hand-authored-only fake fixtures as sole proof.

## 6. Matching engine and algorithm

A naive `action[i] ↔ action[i]` alignment breaks on inserted steps. Implement a reproducible and explainable matcher:
1. Determine logical test identity from metadata; if missing use user selection; never silently compare unrelated tests.
2. Group by test → page/frame → nested step/action; tolerate missing page ids with warnings.
3. Canonicalize action label, API method, locator *shape* (strip dynamic IDs) and URL path (ignore configured keys), source location and neighbor context.
4. Anchor high-confidence unique stable IDs/names/source. Match monotonic sequences using dynamic programming with gap penalties; for long traces use windowed/hierarchical alignment to bound `O(nm)`.
5. Score weighted features: action type 0.30, normalized locator 0.25, URL 0.15, neighbor context 0.15, source 0.10, relative position 0.05 (initial suggested defaults; tune fixtures). Show confidence; no magic auto-matching of ambiguous repeats.
6. Confident unique pairs are linked; low confidence shows alternatives and supports manual pair/unpair; manual overrides live in report config and survive browser session/export.
7. Deterministically output added/removed/moved/reordered actions, not just timing changes. Distinguish reroute navigations vs changed expected URLs.

Unit tests: inserted click, removed wait, repeated selectors, reordered requests, nested steps, incomplete events, two tabs, changed test names, action retries, 1,000+ actions; repeatable same output from same inputs.

## 7. Analysis engine — all mandatory

### 7.1 Duration/regression

- Compare total recorded test duration only when equivalent measurement scopes are present.
- Per matched action: delta milliseconds and percentage. Flag when both `increase >= minAbsoluteMs` and `relative increase >= minRelativeIncrease`, with small-baseline guard. Defaults proposed: 100ms, 20%; user-editable.
- Show distribution, longest regressions, before/after timeline and confidence. Never call one run proof of performance regression: default headline “candidate slower in this recording”; suggest repeat runs for statistical confidence.
- Optional N-run aggregates in P2: median, p90, IQR and sample count; only when supplied multiple independent runs, never fabricated.

### 7.2 Network differences

- Group and align by method, normalized host/path, resource type, initiator/action window and occurrence index; allow duplicate requests.
- Find newly added requests, missing requests, new 4xx/5xx, status changes, failed requests, latency deltas and request count changes. Never assume third-party resources deterministic.
- Built-in noise filters for analytics/ad/tracking endpoints disabled by default but easy to toggle; show explicitly what was suppressed.
- Headers/payloads collapsed and redacted. No need to store raw HAR; support future sanitized HAR import only if independently tested.

### 7.3 Console/error changes

- Group errors by type, normalized message and stack fingerprint (omit secrets and ephemeral line shifts). Added/removed/error count changes.
- Explain sources: `trace recorded console`, `network failure`, `test assertion` when known. Do not infer unrecorded console events.

### 7.4 Visual differences

- UI modes: side-by-side, overlay slider, blink, heatmap, diff-only, download image (explicit opt-in).
- Screenshot candidate pairing based on matched action + nearest relevant stage; use exact before/after screenshots only when trustworthy provenance is available.
- Handle unequal dimensions: default “incomparable dimensions” warning; optional explicit fit/crop with documented transform. Do **not** silently resize to hide differences.
- `pixelmatch` with configurable threshold/anti-alias handling, alpha and RGBA conversion, optional mask rectangles drawn interactively. Report changed-pixel ratio and count; distinguish perceptual similarity score from actual pixel ratio.
- Missing screenshots => `not available`, never false pass. Exclude animated/dynamic regions only after user mask/config, retain evidence.

### 7.5 Findings and severity

Rules are deterministic, versioned (`RD-NET-001`, `RD-VIS-001`, etc.), individually enabled/disabled. Severity depends on user thresholds and evidence: 5xx introduced high, unrecorded data not a severity, 404 of known critical endpoint configurable. Every finding includes evidence refs, original and changed values, uncertainty and suggested investigation path. The summary must show counts by category/status and “coverage/limitations”.

## 8. UI/UX specification

**Visual direction:** polished engineering instrument, neutral light/dark themes, restrained accent, typography `Inter/Geist` or fallback; no gratuitous colorful badges. 1440px desktop showcase but responsive minimum 360px.

Screens:
1. **Landing/demo:** headline, “Try sample”, “Compare local traces”, privacy statement, concise 3-step usage, CLI install.
2. **Import wizard:** before/after drop zones, file validation, progress and cancel, trace/test selection, supported features checklist.
3. **Results dashboard:** comparison name, recorded browser/versions, duration deltas, network/errors/visual counts, warning strip, top regressions, export.
4. **Action explorer:** left virtualized before↔after action tree, status icons and confidence; main pane with Before/After, visual diff, timing, network, console and raw normalized metadata; selectable time ranges.
5. **Network explorer:** grouped requests with status/latency change, filters (domain/method/status/resource/action), request detail and matching rationale.
6. **Visual gallery:** grid of paired screenshots, inspect pixel diff/masks, reason why paired.
7. **Settings/Export:** thresholds, URL normalizers, privacy redaction preview, report JSON/HTML/Markdown, CLI command equivalent.
8. **Help/Compatibility:** formats, no-screenshot caveat, samples, privacy and troubleshooting.

States: empty, loading, invalid archive, unsupported format, partially parsed, worker crashed/restart, canceled, no differences, no matching actions, no screenshots, oversized file, unsupported image decode, keyboard-only navigation. Provide a persistent but unobtrusive “Local processing — traces not uploaded” label where true.

Accessibility: WCAG 2.2 AA intent, focus order, aria labels, color contrast, no color-only diff encoding, reduced-motion, 200% zoom, screen reader meaningful tables and text equivalents for visuals.

## 9. CLI contract (mandatory P1)

Package executable name `run-diff` (verify npm availability before publishing; if occupied choose `@sanestly/run-diff` with `bin` named `sanestly-run-diff`). No assumptions about npm names.

```bash
pnpm install
pnpm -r build
pnpm --filter @sanestly/run-diff-cli test

# Intended public commands, not claims of existing code:
npx @sanestly/run-diff compare before.zip after.zip --format html,json,md --out ./diff-report
npx @sanestly/run-diff inspect ./trace.zip --format json
npx @sanestly/run-diff compare ./a.zip ./b.zip --fail-on high --config run-diff.config.json
```

- `inspect`: metadata, tests, capabilities, parse warnings.
- `compare`: same normalizer/matcher/analysis core as web; configured thresholds, import/export, deterministic output order.
- `--format`: JSON, Markdown, self-contained sanitized HTML; `--json` stdout machine-only with progress stderr.
- `--fail-on critical|high|medium|low|none`, plus skip suppressed findings; `--strict-unsupported` fails on unavailable mandatory capabilities.
- Exit codes: 0 success/no threshold breach, 1 findings breach, 2 invalid arguments/input/unsupported required format, 3 internal failure.
- CLI should not emit raw trace content by default; error messages cannot leak secrets; paths printed safely.
- CI sample workflow: upload baseline/candidate artifacts into job, run CLI locally, upload sanitized report, annotate PR summary; do not depend on paid API.

## 10. Security, privacy, telemetry

- No trace upload API. Explicitly prohibit Sentry/analytics on uploaded trace content, auto-persist, third-party images or remote AI prompts.
- Traces may contain credentials, PII, cookies, tokens, request bodies and proprietary source. Redact `Authorization`, cookies, standard credentials, query token keys, and user-configured regex patterns **before rendering/export** where applicable. Binary screenshots may still contain secrets; default exported report excludes screenshots unless user explicitly opts in and sees warning.
- Treat all trace strings as untrusted text; no HTML injection, javascript: URL execution, unsafe `dangerouslySetInnerHTML`, markdown remote resource loading. CSP, no third-party scripts, object URL revoke, strict MIME for download.
- Client-only processing eliminates app-server upload but does not prove browser, extension or CDN security; state honest boundaries.
- ZIP exhaustion protection, image decode limits, worker timeout/recovery; fuzz archive metadata/parser and malformed image resources.
- Add `SECURITY.md`, `PRIVACY.md`, secret-rotation procedure if accidental trace fixture leak, dependency scanning and SBOM release artifact.

## 11. Performance targets (engineering budgets, not guarantees)

Measure on documented reference machines:
- 10–20 MiB archives: import + summary should target < 5 s after worker ready on modern desktop; fail release gate only if benchmark confirms regression beyond 2× verified baseline.
- Typical 1,000-action trace pair should keep main thread responsive (no > 200ms avoidable blocking tasks).
- Worker memory within agreed cap and release on reset; show user warning rather than crash on oversized archives.
- Lazy virtualized action/request tables; screenshot decodes only when visible.
- Static build target practical (document gzip JS size, wasm/assets load); no requirement to download Node at runtime.

## 12. Implementation plan — every phase mandatory

### P0 — trace comparison core

P0.1 Scaffold monorepo, TS types, CI, deterministic fixtures, public README stub.  
P0.2 Build archive probe/limits/ZIP security and cancellation.  
P0.3 Add two real-version trace adapters, JSONL parser, normalized timeline and trace capabilities.  
P0.4 Implement logical run selector and anchored sequence alignment with tests.  
P0.5 Timing, network status/request-count, errors/console differences; deterministic report schema.  
P0.6 Browser import → comparison dashboard → action explorer; sample pair; empty/error/partial states.  
**P0 gate:** 2 independent real traces produce useful ordered differences; corrupt ZIP fails safely; browser does not upload bytes.

### P1 — complete product features

P1.1 Screenshot pairing, pixel diff/slider/heatmap, ignore masks, dimension/availability handling.  
P1.2 Advanced network diagnostics, filtering, matched action evidence, manual pairing/unpairing.  
P1.3 Settings, suppression rules, shareable **sanitized reports**, JSON import, HTML/Markdown export.  
P1.4 CLI Node using identical core + exit codes and CI usage examples.  
P1.5 Keyboard navigation, dark/light, responsive design, all loading/unknown states.  
**P1 gate:** browser and CLI reports structurally equal for same fixture/config (except deterministic environment metadata).

### P2 — OSS release and advanced validation

P2.1 Multi-trace batch comparison/aggregated timing with correct statistics and warnings.  
P2.2 Large archive optimized lazy decompression and UI virtualization; fuzz tests.  
P2.3 Compatibility matrix for Playwright variants and official change-log watch; no unverified version claims.  
P2.4 Golden fixtures, security review, cross-browser tests, accessibility audit and real-user walkthroughs.  
P2.5 Publish static live demo, public tagged release, downloadable sanitized sample traces, docs, changelog, issue templates, contribution guide, `good first issue` candidates and GitHub social preview.  
**P2 gate:** release checklist passes; no material P0/P1/P2 requirement remains intentionally mocked or deferred.

## 13. Test plan and mandatory acceptance scenarios

**Unit:** parsers with type guards and corrupt lines; normalization; regex/path sanitization; timestamps; sequence alignment; matcher ambiguity; timing thresholds; request classification; screenshot dimension/crop; redaction; report schema migrations.

**Integration:** generate real traces in CI for Chromium: one stable baseline, one with additional action, changed response code, console error, modified screenshot and slower action; compare browser/CLI outputs. Pin trace fixtures from at least two tested Playwright versions, include API-only and Test Runner traces. No “screenshot present” assertion on traces recorded without screenshots.

**E2E:**
- E01 demo loads without backend/auth, comparison visible.
- E02 paired ZIP upload, progress, complete report.
- E03 malformed ZIP reports clear error and no JS exception.
- E04 0 valid events → unsupported/invalid not green success.
- E05 inserted action => added, not every subsequent action marked changed.
- E06 identical inputs => no false behavioral changes.
- E07 changed HTTP 200→500 => request finding evidence.
- E08 screenshots with 5% pixel change => diff visible with numerical ratio; missing screenshots => availability notice.
- E09 manual pairing/ignore mask survives settings export/import.
- E10 HTML exported offline opens and contains redacted data, no raw credentials.
- E11 browser and CLI JSON agree on golden fixture.
- E12 keyboard and reduced motion function.
- E13 cancel large upload and immediately compare smaller traces without memory leak.
- E14 secrets in URL, headers and console do not leak in sanitized report.
- E15 CLI exit codes and PR workflow behavior reproducible.
- E16 untrusted trace text cannot execute scripts.

Set documented test-count expectations but never fabricate CI coverage. CI matrix: Node LTS, lint, typecheck, unit, build, E2E Chromium/Firefox/WebKit where supported, security scans, fixture integrity and license audit.

## 14. Repo/release deliverables and discoverability

Must ship: `README.md` (English first; Russian optional), `LICENSE`, `CHANGELOG.md`, `SECURITY.md`, `PRIVACY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `docs/architecture.md`, `docs/trace-compatibility.md`, `docs/report-schema.md`, `docs/cli.md`, fixtures provenance manifest, CI workflows, npm release instructions, public demo, OG image, GIF/video ≤60s, issue/PR templates, tagged GitHub v1.0.0 and release notes.

README above the fold: product screenshot/GIF, one-sentence differentiator, Live Demo, Try sample, `npx` usage, privacy, current compatibility matrix. Sanestly listing displays stars only after repo is actually public; no fabricated badges or testimonials.

Potential adoption metrics (opt-in aggregate site only, never traces): demo starts, fixture comparisons, CLI downloads (registry's public downloads), GitHub Stars; no private trace telemetry. A/B marketing work may be deferred, not core functionality.

## 15. Risks, assumptions, and stop conditions

- **Format drift:** undocumented Playwright trace format. Mitigation: version adapters, reproducible fixtures, clear unsupported labels; never forge parsing success.
- **False regression:** one sample is noisy. Mitigation: threshold and uncertainty language, N-run P2.
- **Sensitive content:** traces frequently contain secrets. Mitigation: local-only processing, redaction and explicit screenshot export consent.
- **Duplicate positioning:** official Trace Viewer already provides individual trace inspection and screenshot diffs. Mitigation: useful cross-run action/network/performance alignment, not superficial viewer.
- **Complexity:** indefinite support for every language and producer. Scope release to tested archives and publish exact matrix.

Release blocked if one of: arbitrary code executes via trace content; sensitive data appears in default report; core matching produces grossly incorrect mapping on golden fixtures; critical browsers fail; no real recorded trace tests; demo or install commands do not work.

## 16. Agent execution instructions (paste with this file)

```text
Implement the complete Sanestly Playwright Run Diff product described in this document.
Work in the target repository. Inspect the existing code and preserve valuable code; do not
rewrite unrelated files. Implement P0, P1, P2, tests, docs, release tooling and static demo.
Do not label mocks or placeholders as done. Verify upstream Playwright trace compatibility
using generated real fixtures; capture actual command output and CI results. On format drift,
update adapters and tests, document exact versions, and proceed. Report at completion:
repository tree, features, commands executed, passing/failing tests, measured limits,
security/privacy checks, demo URL (if deployed), release artifacts, remaining verified blockers.
Never claim deployment/publication unless it actually occurred.
```

## 17. Verified sources (reviewed 2026-10-18)

1. https://playwright.dev/docs/trace-viewer — official Trace Viewer behavior and trace usage.
2. https://playwright.dev/docs/api/class-tracing — Test Runner vs context trace differences, capture flags.
3. https://github.com/microsoft/playwright/blob/main/.claude/skills/playwright-dev/trace_system_guide.md — current repository trace system guide; internal structure is non-public compatibility commitment.
4. https://github.com/microsoft/playwright — canonical repository and license inspection.

**Source policy:** recheck actual upstream API versions, package availability, licenses, and documented compatibility at implementation time. This document is a target contract, not a claim that all integrations were experimentally verified.
