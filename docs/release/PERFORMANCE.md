# Performance benchmark results

Date: 2026-10-18. Environment: macOS (darwin arm64, Apple Silicon), Node.js v24.7.0, Playwright 1.64.1.

## Method

Synthetic load fixtures are generated inside `scripts/bench-large.mjs` - real trace-format JSONL events plus incompressible pseudo-JPEG screenshot payloads. They exercise the real `readTraceArchive` + `compareRuns` pipeline. Pixel-diff decode is stubbed in this bench (random bytes are not decodable); JPEG/PNG decode cost is covered by unit tests and real fixtures - decoding a 800x600 JPEG is ~2-5ms.

Command:

```bash
pnpm -r build && node --expose-gc scripts/bench-large.mjs
```

## Measured results

| Size | Compressed/side | Actions | Requests | Parse+normalize | Compare | Findings | Peak RSS delta |
| --- | --- | --- | --- | --- | --- | --- | --- |
| small | ~3.9 MiB | 2,000 | 500 | ~95 ms | ~0.8 s | 56 | +7 MiB |
| medium | ~39 MiB | 12,000 | 3,000 | ~290 ms | ~2.9 s | 231 | +74 MiB |
| large | ~110 MiB | 40,000 | 10,000 | ~370 ms | ~4.2 s | 554 | +256 MiB |
| oversized | 400 MiB | - | - | rejected before inflate | - | - | - |

- Oversized archives fail fast: `[TOO_LARGE_COMPRESSED] Archive is 400.1 MiB compressed, exceeding the 150 MiB limit` - limits enforced before unsafe work.
- Malformed JSONL inside a valid archive produces a warning, not a crash (`warnings=1, actions=1`).

## Memory model (honest)

- The compressed archive is fully inflated into memory at parse time. This is **bounded**, not streaming: hard caps are 150 MiB compressed (300 MiB absolute ceiling) and 600 MiB aggregate uncompressed. Observed RSS delta on the 110 MiB archive is +256 MiB - consistent with in-memory inflation plus parsed structures.
- Screenshot bytes are exposed lazily via `getResource(name)`; pixel diffing decodes one pair at a time inside the worker.
- Streaming decompression is deliberately **not** implemented: measured memory stays within documented caps, and the browser worker isolates the cost. If traces above ~150 MiB need support, this is the known limit.

## Browser/UX notes

- Parse + compare run inside a dedicated Web Worker; the main thread stays responsive during the measured workloads.
- Action and network tables are virtualized (`apps/web/src/virtual.ts`), so DOM size is capped regardless of action count.
- Cancellation terminates and restarts the worker; a new compare can start immediately after cancel.
- Matcher is banded Needleman-Wunsch: O(n * band) time/memory; a `Map`-based similarity cache that exceeded V8's max Map size at ~40k actions was removed (it only ever served each cell once).

## Regression guard

`packages/matcher/test/align.test.ts` includes a 1,200-action performance sanity test. Re-run `bench-large.mjs` after matcher or reader changes.
