#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { ComparisonSettings, Severity } from '@sanestly/contracts';
import { reportToJson } from '@sanestly/report';
import { ArchiveSecurityError } from '@sanestly/trace-reader';
import { openTrace, runComparison, writeReportFiles } from './pipeline.js';

const EXIT_OK = 0;
const EXIT_BREACH = 1;
const EXIT_USAGE = 2;
const EXIT_INTERNAL = 3;

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

const USAGE = `run-diff - compare two Playwright trace archives

Usage:
  run-diff compare <before.zip> <after.zip> [options]
  run-diff compare <b1.zip,b2.zip,...> <c1.zip,c2.zip,...> [options]
  run-diff inspect <trace.zip> [--format json]
  run-diff help

Multi-run: comma-separated archives per side produce aggregate median/p90
timing findings (needs >=2 runs per side; p90 reported for n>=10).

Options:
  --format json,md,html    Output formats (default: json)
  --out <dir>              Output directory for report files (default: ./diff-report)
  --json                   Print report JSON to stdout (progress goes to stderr)
  --fail-on <severity>     critical|high|medium|low|none - exit 1 when met (default: none)
  --config <file>          JSON file with ComparisonSettings overrides
  --before-run <n>         Logical run index for before archive (default: 0)
  --after-run <n>          Logical run index for after archive (default: 0)
  --max-size-mb <n>        Compressed size cap per archive (default: 150, max: 300)
  --no-visual              Skip screenshot pixel diffing
  --version                Print version
`;

interface ParsedArgs {
  command?: string;
  positional: string[];
  formats?: string[];
  out?: string;
  json?: boolean;
  failOn?: string;
  config?: string;
  beforeRun?: number;
  afterRun?: number;
  maxSizeMb?: number;
  visual: boolean;
  help?: boolean;
  version?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positional: [], visual: true };
  const args = [...argv];
  out.command = args.shift();
  // `run-diff --version` / `-v` have no command word - the flag IS the command.
  if (out.command === '--version' || out.command === '-v' || out.command === 'version') {
    out.version = true;
    out.command = undefined;
  } else if (out.command === '--help' || out.command === '-h') {
    out.help = true;
    out.command = undefined;
  }
  while (args.length) {
    const arg = args.shift()!;
    switch (arg) {
      case '--format':
        out.formats = (args.shift() ?? '').split(',').map((s) => s.trim().toLowerCase());
        break;
      case '--out':
        out.out = args.shift();
        break;
      case '--json':
        out.json = true;
        break;
      case '--fail-on':
        out.failOn = args.shift()?.toLowerCase();
        break;
      case '--config':
        out.config = args.shift();
        break;
      case '--before-run':
        out.beforeRun = Number(args.shift());
        break;
      case '--after-run':
        out.afterRun = Number(args.shift());
        break;
      case '--max-size-mb':
        out.maxSizeMb = Number(args.shift());
        break;
      case '--no-visual':
        out.visual = false;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      case '--version':
      case '-v':
        out.version = true;
        break;
      default:
        if (arg.startsWith('--')) {
          fail(`Unknown option ${arg}`, EXIT_USAGE);
        }
        out.positional.push(arg);
    }
  }
  return out;
}

function fail(message: string, code: number): never {
  console.error(`run-diff: ${message}`);
  process.exit(code);
}

function loadSettings(path?: string): Partial<ComparisonSettings> | undefined {
  if (!path) return undefined;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    fail(`Cannot read config file ${basename(path)}`, EXIT_USAGE);
  }
  try {
    const parsed = JSON.parse(raw) as { settings?: Partial<ComparisonSettings> } & Partial<ComparisonSettings>;
    return parsed.settings ?? parsed;
  } catch {
    fail(`Config file ${basename(path)} is not valid JSON`, EXIT_USAGE);
  }
}

function severityBreached(
  failOn: string | undefined,
  findings: Array<{ severity: Severity; suppressed?: boolean }>,
): boolean {
  if (!failOn || failOn === 'none') return false;
  const threshold = SEVERITY_RANK[failOn as Severity];
  if (threshold === undefined) fail(`Invalid --fail-on value "${failOn}"`, EXIT_USAGE);
  return findings.some((f) => !f.suppressed && SEVERITY_RANK[f.severity] >= threshold && threshold > 0);
}

function cmdInspect(positional: string[], args: ParsedArgs): void {
  const path = positional[0];
  if (!path) fail('inspect requires a trace zip path', EXIT_USAGE);
  const archive = openTrace(path, args.maxSizeMb ? { maxCompressedBytes: args.maxSizeMb * 1024 * 1024 } : undefined);
  const trace = archive.trace;
  const info = {
    source: trace.sourceLabel,
    playwrightVersion: trace.recordedVersion ?? null,
    browser: trace.browser ?? null,
    viewport: trace.viewport ?? null,
    timeOrigin: trace.timeOrigin ?? null,
    archiveEntries: archive.probe.groups.length
      ? archive.probe.groups.map((g) => ({
          prefix: g.prefix || '(root)',
          trace: g.traceFiles,
          network: g.networkFiles,
          stacks: g.stackFiles,
        }))
      : [],
    resources: archive.probe.resources.length,
    runs: trace.runs.map((r) => ({
      id: r.id,
      label: r.label,
      actions: r.actions.length,
      requests: r.requests.length,
      consoleEvents: r.consoleEvents.length,
      errors: r.errors.length,
      screenshots: r.screenshots.length,
      capabilities: r.capabilities,
    })),
    warnings: trace.warnings,
  };
  console.log(JSON.stringify(info, null, 2));
}

function cmdCompare(positional: string[], args: ParsedArgs): void {
  const [beforePath, afterPath] = positional;
  if (!beforePath || !afterPath) {
    fail('compare requires <before.zip> and <after.zip>', EXIT_USAGE);
  }
  const settings = loadSettings(args.config);
  const limits = args.maxSizeMb ? { maxCompressedBytes: args.maxSizeMb * 1024 * 1024 } : undefined;

  const { report } = runComparison(beforePath, afterPath, {
    settings,
    limits,
    beforeRun: args.beforeRun,
    afterRun: args.afterRun,
    visual: args.visual,
  });

  const formats = args.formats ?? ['json'];
  if (args.json) {
    process.stdout.write(reportToJson(report));
  }
  if (args.out || !args.json) {
    const written = writeReportFiles(report, formats, args.out ?? './diff-report');
    for (const p of written) console.error(`wrote ${p}`);
  }
  const counts = report.summary;
  console.error(
    `findings: ${counts['findings.total']} (critical ${counts['findings.critical']}, high ${counts['findings.high']})`,
  );

  if (severityBreached(args.failOn, report.findings)) {
    console.error(`run-diff: findings at or above --fail-on ${args.failOn} threshold`);
    process.exit(EXIT_BREACH);
  }
  process.exit(EXIT_OK);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.version) {
    console.log('run-diff 0.9.0-beta.1');
    return;
  }
  if (args.help || !args.command || args.command === 'help') {
    console.log(USAGE);
    return;
  }
  try {
    switch (args.command) {
      case 'inspect':
        cmdInspect(args.positional, args);
        break;
      case 'compare':
        cmdCompare(args.positional, args);
        break;
      default:
        fail(`Unknown command "${args.command}"\n\n${USAGE}`, EXIT_USAGE);
    }
  } catch (err) {
    if (err instanceof ArchiveSecurityError) {
      fail(`[${err.code}] ${err.message}`, EXIT_USAGE);
    }
    fail(`internal error: ${err instanceof Error ? err.message : String(err)}`, EXIT_INTERNAL);
  }
}

main();
