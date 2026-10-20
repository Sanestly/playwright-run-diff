# @sanestly/run-diff

Compare two Playwright trace runs and locate behavioral regressions - actions, timings, network, console/errors and screenshots - with a reproducible, privacy-aware diff report. Runs entirely locally; no trace data leaves your machine.

## Install

```bash
npm install -g @sanestly/run-diff
# or run without installing
npx @sanestly/run-diff compare before.zip after.zip
```

## Usage

```bash
# Compare two trace archives, write JSON + Markdown + self-contained HTML
run-diff compare before.zip after.zip --format json,md,html --out ./diff-report

# Inspect a single archive (streams, capabilities, warnings)
run-diff inspect trace.zip

# Fail CI when a finding meets the threshold (exit 1)
run-diff compare a.zip b.zip --fail-on high

# Machine-readable stdout (progress goes to stderr)
run-diff compare a.zip b.zip --json

# Pick which run inside a multi-stream archive to compare
run-diff compare a.zip b.zip --before-run 2 --after-run 2

# Multi-run aggregate statistics (comma-separated archives per side)
run-diff compare a1.zip,a2.zip b1.zip,b2.zip --format md

# Read options from a config file
run-diff compare a.zip b.zip --config run-diff.config.json
```

Exit codes: `0` below threshold, `1` threshold breach, `2` invalid input/arguments, `3` internal failure.

See the [CLI docs](https://github.com/sanestly/playwright-run-diff/blob/main/docs/cli.md) and [repository](https://github.com/sanestly/playwright-run-diff) for the browser UI, report schema and trace compatibility matrix.

## Privacy

Reports sanitize authorization headers, cookies, tokens and sensitive query values. Screenshots are not embedded by default. All processing is local.

## License

MIT
