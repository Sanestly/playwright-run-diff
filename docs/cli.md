# CLI reference

Executable: `run-diff` (package `@sanestly/run-diff`).

## Commands

### `run-diff compare <before.zip> <after.zip>`

Compares two trace archives with the same core engine as the web app.

```
--format json,md,html   output formats (default: json)
--out <dir>             output directory (default: ./diff-report)
--json                  write report JSON to stdout (progress on stderr)
--fail-on <severity>    critical|high|medium|low|none - exit 1 when findings at or above it exist
--config <file>         JSON file with ComparisonSettings overrides (see run-diff.config.example.json)
--before-run <n>        logical run index in the before archive (default 0)
--after-run <n>         logical run index in the after archive (default 0)
--max-size-mb <n>       compressed cap per archive (default 150, max 300)
--no-visual             skip screenshot pixel diffing
```

### `run-diff inspect <trace.zip>`

Prints archive metadata as JSON: producer version, runs, capabilities, parse warnings, entry groups.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | comparison succeeded, no findings at or above `--fail-on` |
| 1 | findings at or above the `--fail-on` threshold (suppressed findings are skipped) |
| 2 | invalid arguments, unreadable/unsupported/oversized archive |
| 3 | internal failure |

## CI example

```yaml
- name: Compare traces
  run: |
    node apps/cli/dist/bin.js compare baseline.zip candidate.zip \
      --format html,json,md --out diff-report --fail-on high
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: run-diff-report
    path: diff-report/
```

The emitted report is sanitized - it is safe to attach to a CI build. Suppressed findings are listed but do not trip `--fail-on`.
