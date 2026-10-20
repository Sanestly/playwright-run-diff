# Security Policy

## Reporting

Report vulnerabilities privately via GitHub Security Advisories on the repository, or by emailing the maintainers listed in the repository profile. Do not open public issues for security reports.

## Scope and threat model

This tool processes **untrusted trace archives** that may contain credentials, PII, cookies, tokens and proprietary source code. The design mitigations:

- All processing is local (browser Web Worker or local Node CLI). There is no upload endpoint.
- ZIP ingestion validates magic bytes and the central directory, rejects split/encrypted archives, zip-slip paths, duplicate entries, oversized inputs and extreme compression ratios.
- JSONL parsing isolates malformed lines; oversized lines are rejected.
- URL normalization redacts query-parameter values for sensitive keys and token-looking values. Console/error text passes through credential/JWT redaction.
- The exported HTML report is fully escaped, embeds a restrictive CSP, loads no remote resources and includes no scripts.
- Screenshot binaries are never embedded in exported reports.
- Report parsing rejects unknown major schema versions.

## If a fixture leaks a secret

Fixture zips are generated against a deterministic localhost server and reviewed for secrets. If an accidental leak is discovered:

1. Rotate the credential immediately - history rewriting is not sufficient.
2. Replace or regenerate the fixture via `pnpm fixtures:generate`.
3. Purge caches and force-push only after rotation, documenting the incident in CHANGELOG.

## Dependency audit

Dependencies are locked in `pnpm-lock.yaml`. CI runs `pnpm audit` (see `.github/workflows/ci.yml`). Release gates: 0 critical/high known vulnerabilities.
