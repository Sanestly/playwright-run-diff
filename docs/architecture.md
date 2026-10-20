# Architecture

## Data flow

```
before.zip / after.zip
      |  local ZIP guard, entry classifier, provenance
TraceArchiveReader (Web Worker in browser / plain function in CLI)
      |  format adapters + diagnostics
NormalizedTrace x 2   (runs -> actions, requests, console, errors, screenshots)
      |  run selection + anchored sequence alignment
ActionPair[] + ManualMappingOverrides
      |  analysis rules (timing, network, console/error, visual)
DiffFinding[] + EvidenceRef[] + Confidence + Limitations
      |                                     |
React Explorer                    CLI -> JSON / Markdown / HTML
```

## Packages

| Package | Responsibility |
| --- | --- |
| `@sanestly/contracts` | Normalized types, `ComparisonReport` shape, Zod schema, defaults. Versioned `schemaVersion: "1.0"`. |
| `@sanestly/trace-reader` | ZIP security (`openArchive`), entry probe (`probeArchive`), JSONL isolation (`parseJsonLines`), format adapters, event normalizer, URL/text redaction. |
| `@sanestly/matcher` | Weighted action similarity + anchor-pinned Needleman-Wunsch alignment + manual overrides. |
| `@sanestly/analysis` | Finding rules (`RD-*`), timing deltas, request alignment, console/error grouping, `diffRgba` pixel diff via pixelmatch. |
| `@sanestly/report` | Deterministic JSON (sorted keys), Markdown, self-contained escaped HTML. |
| `apps/cli` | `run-diff` executable: `compare`, `inspect`, thresholds, exit codes. |
| `apps/web` | Vite + React SPA; all heavy work happens in `src/worker.ts` (Web Worker). |

## Key design decisions

### The trace format is not a public contract

Playwright's trace layout is internal. The reader therefore:

1. **Probes** entry names instead of assuming `trace.trace` - any `<prefix>.trace`/`.network`/`.stacks` group becomes a logical run.
2. Uses **adapters** (`playwright-modern`, `playwright-generic`) selected per stream via `canParse` confidence (`supported`/`partial`/`unsupported`).
3. Records unknown event types as warnings rather than dropping them silently.
4. Normalizes timestamps per run on the monotonic clock (`startTime`/`endTime`/`monotonicTime`/`time` are all accepted) and never compares wall-clock epochs between runs.

### Matching

Index-based pairing breaks on inserted steps, so alignment is anchor-pinned global alignment:

- **Anchors**: actions whose `(apiName, locator fingerprint, URL fingerprint, source)` key is unique on both sides - hard pins.
- **Segments**: bounded Needleman-Wunsch DP between anchors with weighted feature scores (type .30, locator .25, URL .15, neighbor .15, source .10, position .05).
- Pairs below `minimumConfidence` are reported as added+removed rather than force-matched.
- Manual overrides live in settings and survive export.

### Security boundaries

- `openArchive` validates magic + EOCD, rejects split archives, unsafe paths, duplicate normalized names, count/size/ratio bombs before inflating.
- Nothing from a trace is rendered as HTML, and exports are escaped + CSP-locked.
- Raw trace bytes live only in memory for the session; the worker releases them on reset/cancel.
