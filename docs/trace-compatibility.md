# Trace compatibility

The Playwright trace format is **not a stable public interchange format**. This file documents what was verified against real recorded traces in this repository.

## Verified matrix

| Producer | Version | Browser | Fixture | Status |
| --- | --- | --- | --- | --- |
| `playwright` `context.tracing` | 1.64.1 | Chromium | `fixtures/generated/sample-a`, `identical` | verified (adapter `playwright-modern`) |
| `playwright` `context.tracing` | 1.64.1 | Firefox | `fixtures/generated/firefox` | verified |
| `playwright` `context.tracing` | 1.64.1 | WebKit | `fixtures/generated/webkit` | verified |
| `playwright-core` `context.tracing` | 1.60.0 | Chromium | `fixtures/generated/v1.60` | verified - screencast frames under `resources/` |
| `@playwright/test` `use: { trace: 'on' }` | 1.64.1 | Chromium | `fixtures/generated/test-runner` | verified - multi-stream archive |
| `@playwright/test` `use: { trace: 'on' }` | 1.64.1 | Firefox | `fixtures/generated/test-runner-firefox` | verified |
| `@playwright/test` `use: { trace: 'on' }` | 1.64.1 | WebKit | `fixtures/generated/test-runner-webkit` | verified |
| Playwright < 1.60 | - | - | - | NOT VERIFIED |
| Non-JS SDK producers (Python/.NET/Java) | - | - | - | NOT VERIFIED - likely similar event schema, falls back to tolerant adapter |

Regenerate with `pnpm fixtures:generate` (requires `npx playwright install chromium`). Per-browser: `FIXTURE_BROWSER=firefox FIXTURE_OUT=fixtures/generated/firefox node scripts/generate-fixtures.mjs`. For a second producer version, install that version into a scratch directory with a matching browser and run `PW_MODULE=/path/to/playwright-core/index.mjs node scripts/generate-fixtures.mjs`. Test-runner fixtures regenerate with `node scripts/generate-test-runner-fixture.mjs` (`FIXTURE_BROWSER=firefox|webkit` for other engines).

## Browser-engine notes

- **Firefox** screencast frames carry ~1.6% JPEG compression noise even between identical runs. Pixel diffs under ~2% are therefore reported at `info` severity with an explicit noise caveat; `--fail-on medium` is not triggered by noise.
- **WebKit** records fewer screencast frames (~4 for the fixture flow vs ~20 on Chromium/Firefox); unpaired frames surface as info-level findings, never as passes.
- Test-runner archives expose the empty `browserName` on `test.trace`; the archive-level browser is taken from the context stream.

## Test-runner (Playwright Test) archives

`@playwright/test` traces contain **multiple streams** inside one zip:

- `test.trace` - the testRunner stream: test steps, hooks, fixtures, `pw:api` calls and `expect` assertions (`method: "expect"`, locator under `params.locator`).
- `N-trace.trace/network/stacks` - one group per browser context (0 = beforeAll/afterAll hooks, 1 = the test page context).
- `screencast/*.jpeg`, `resources/*`, `src/*` - shared payloads.

Each stream is exposed as a separate logical **run** (`run:test`, `run:1-trace`, ...). Pick the run to compare via the run selector in the web UI or `--before-run`/`--after-run` in the CLI. `run:test` compares test-level structure (steps, expect calls); `run:1-trace` compares browser-level actions/network/screenshots.

## Field mapping (verified on 1.60.0 - 1.64.1)

| Trace field | Normalized field |
| --- | --- |
| `context-options.browserName / playwrightVersion / options.viewport / wallTime` | `trace.browser / recordedVersion / viewport / timeOrigin` |
| `before.callId / class / method / apiName / params / startTime` | `NormalizedAction` start (label = `class.method` or `apiName`) |
| `after.callId / endTime / error / attachments` | action end, failure, screenshot refs |
| `params.selector / selectorString / locator` | action `selectors` |
| `console.messageType / text / time / pageId` | `NormalizedConsoleEvent` |
| `log` events | `action.logs` (internal action logs, **not** console events) |
| `event.method === 'pageError'/'console'` | errors / console events |
| `resource-snapshot.snapshot.{pageref,_monotonicTime,time,request,response,_resourceType,_failureText}` | `NormalizedRequest` |
| `screencast-frame.{file,width,height,timestamp}` | `ScreenshotMeta` (bytes under `screencast/` or `resources/`) |
| `trace.stacks {files, stacks:[[callId,[[fileIdx,line,col]...]]]}` | `action.source` |

## Known caveats

- `browserContext.tracing` does not record assertions or `test.step` semantics from Playwright Test - capability `assertions` reports `absent` and the UI shows "not recorded". Test-runner traces **do** record assertions.
- `snapshots: true` produces `frame-snapshot` DOM payloads; they are parsed for capability detection only and are **never** exported.
- Trace `log` events (e.g. "navigating to...", "waiting for selector") are action logs; they are attached to their action and never counted as console output.
- Unknown event types (e.g. `event:page`) are skipped and counted in `warnings` under the tolerant adapter.
- Third-party endpoints are inherently non-deterministic - suppress via `ignore.urlPatterns`.
- Untested producers (older Playwright versions, non-JS SDKs) fall back to the tolerant `playwright-generic` adapter and are labeled `partial` in warnings; claims beyond verified fixtures are not made.
