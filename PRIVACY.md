# Privacy

## What leaves your machine

**Nothing from your traces.** The browser app performs ZIP decompression, event normalization, action matching, network/console analysis and screenshot pixel-diffing inside a Web Worker on your machine. There is no upload API, analytics on trace content, telemetry, third-party script or remote AI processing.

Hosting the web app on a static host does involve ordinary requests for JS/CSS assets - that is how websites are delivered - but trace bytes are never transmitted.

## What the exported report contains

`comparison-report.json` / `.md` / `.html` include, by design:

- trace metadata (browser, Playwright version, viewport, source file names)
- aligned action pairs with labels, sanitized URLs, timing deltas
- findings with evidence references
- comparison settings and limitations

and never include by default:

- raw URLs with credential query parameters (values are redacted)
- Authorization headers, cookies, request/response bodies
- screenshot or snapshot binaries
- full stack traces or source file contents

## Residual risk

Client-only processing removes the server as a data exposure point but cannot prove the security of your browser, extensions or the CDN serving assets. For maximum isolation, run the CLI locally or self-host the static bundle.
