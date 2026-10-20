# Report schema v1.0

`comparison-report.json` is a deterministic, sanitized JSON document. Object keys are sorted; identical inputs produce byte-identical output (modulo `createdAt`, which is injected).

## Top level

```jsonc
{
  "schemaVersion": "1.0",          // rejected when major version != 1
  "createdAt": "2026-10-18T...",   // ISO 8601
  "toolVersion": "1.0.0",
  "before": { /* TraceSummary */ },
  "after":  { /* TraceSummary */ },
  "pairs":    [ /* ActionPair[] */ ],
  "findings": [ /* DiffFinding[] */ ],
  "summary":  { "findings.total": 12, "...": "number|string|boolean|null" },
  "settings": { /* ComparisonSettings */ },
  "limitations": ["..."]
}
```

### TraceSummary

`id`, `sourceLabel`, `recordedVersion?`, `browser?`, `viewport?`, `timeOrigin?`, `warnings: string[]`, `runCount: number`. Intentionally excludes raw actions/requests/events - reports carry findings, not the whole trace.

### ActionPair

```jsonc
{ "beforeId": "trace.trace#rdyj@10", "afterId": "trace.trace#rdyj@31",
  "confidence": 0.92, "matchReason": ["same action type", "same locator"],
  "manualOverride": false }
```

One side may be absent (`added`/`removed`).

### DiffFinding

```jsonc
{ "id": "F-0007", "category": "network", "severity": "high",
  "status": "changed", "title": "Status changed 200 -> 500: GET ...",
  "details": "...", "evidence": [{"kind":"request","run":"after","id":"trace.network#req-2"}],
  "confidence": 0.95, "ruleId": "RD-NET-004", "suppressed": false }
```

### ComparisonSettings

`timing.{minAbsoluteMs,minRelativeIncrease}`, `match.minimumConfidence`, `visuals.{maxPixelDiffRatio,maskRects[]}`, `ignore.{urlPatterns,actionPatterns,responseHeaders}`.

## Rule ids

| Rule | Meaning |
| --- | --- |
| RD-TIM-001 | matched action slower past both thresholds |
| RD-ACT-001/002/003 | action added / removed / now failing |
| RD-NET-001/002/003/004/005/006 | request added / removed / status changed / 5xx introduced / failed / slower |
| RD-CON-001/002 | console group added / removed |
| RD-ERR-001 | new error recorded |
| RD-VIS-001/002 | pixel diff beyond ratio / screenshot missing or incomparable |

## Versioning

- `1.x` additions are backward compatible (new optional fields, new rule ids).
- A future `2.0` will be rejected by current builds with a migration message.
- Never place raw trace content (headers, bodies, cookies, screenshot bytes) in a report field.
