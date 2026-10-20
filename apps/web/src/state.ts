import { create } from 'zustand';
import type {
  ComparisonReport,
  ComparisonSettings,
  NormalizedTrace,
} from '@sanestly/contracts';
import { DEFAULT_COMPARISON_SETTINGS } from '@sanestly/contracts';
import type { CompareResult, PixelDiffResult } from '@sanestly/analysis';
import type { ManualOverride } from '@sanestly/matcher';
import { workerClient } from './workerClient';

export type View =
  | 'landing'
  | 'dashboard'
  | 'actions'
  | 'network'
  | 'visual'
  | 'console'
  | 'settings'
  | 'help';

export type SideStatus = 'empty' | 'loading' | 'ready' | 'error';

export interface SideState {
  status: SideStatus;
  fileName?: string;
  trace?: NormalizedTrace;
  error?: string;
  progress?: string;
}

interface AppState {
  view: View;
  dark: boolean;
  before: SideState;
  after: SideState;
  comparing: boolean;
  progress?: string;
  report?: ComparisonReport;
  result?: CompareResult;
  pixelDiffs?: PixelDiffResult[];
  settings: ComparisonSettings;
  manualOverrides: ManualOverride[];
  selectedFindingId?: string;
  beforeRun: number;
  afterRun: number;

  setView(v: View): void;
  toggleDark(): void;
  loadFile(side: 'before' | 'after', file: File): Promise<void>;
  loadSample(): Promise<void>;
  compare(): Promise<void>;
  updateSettings(s: Partial<ComparisonSettings>): void;
  addManualOverride(o: ManualOverride): void;
  removeManualOverride(o: ManualOverride): void;
  /** Load a previously exported comparison-report.json for viewing only. */
  viewReport(report: ComparisonReport): void;
  setSelectedFinding(id?: string): void;
  setRunIndex(side: 'before' | 'after', index: number): void;
  reset(): void;
}

const empty: SideState = { status: 'empty' };

export const useStore = create<AppState>((set, get) => ({
  view: 'landing',
  dark: typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)').matches : false,
  before: empty,
  after: empty,
  comparing: false,
  settings: DEFAULT_COMPARISON_SETTINGS,
  manualOverrides: [],
  beforeRun: 0,
  afterRun: 0,

  setView: (view) => set({ view }),
  setRunIndex: (side, index) =>
    set({
      [side === 'before' ? 'beforeRun' : 'afterRun']: index,
      report: undefined,
      result: undefined,
    }),
  toggleDark: () => set((s) => ({ dark: !s.dark })),
  setSelectedFinding: (selectedFindingId) => set({ selectedFindingId }),

  async loadFile(side, file) {
    const key = side === 'before' ? 'before' : 'after';
    set(() => ({
      [key]: { status: 'loading', fileName: file.name, progress: 'reading file' } as SideState,
      report: undefined,
      result: undefined,
    }));
    try {
      const bytes = await file.arrayBuffer();
      const trace = await workerClient.parse(side, bytes, file.name, (phase) =>
        set((s) => ({ [key]: { ...s[key], progress: phase } })),
      );
      set((s) => ({ [key]: { ...s[key], status: 'ready', trace, progress: undefined } }));
    } catch (err) {
      set((s) => ({
        [key]: {
          ...s[key],
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          progress: undefined,
        },
      }));
    }
  },

  async loadSample() {
    const base = import.meta.env.BASE_URL;
    for (const side of ['before', 'after'] as const) {
      const name = side === 'before' ? 'baseline.zip' : 'candidate.zip';
      set(() => ({
        [side]: { status: 'loading', fileName: `sample-a/${name}`, progress: 'fetching sample' },
      }));
    }
    try {
      const [bBytes, aBytes] = await Promise.all([
        fetch(`${base}sample-a/baseline.zip`).then((r) => {
          if (!r.ok) throw new Error('sample fetch failed');
          return r.arrayBuffer();
        }),
        fetch(`${base}sample-a/candidate.zip`).then((r) => {
          if (!r.ok) throw new Error('sample fetch failed');
          return r.arrayBuffer();
        }),
      ]);
      const [bTrace, aTrace] = await Promise.all([
        workerClient.parse('before', bBytes, 'sample-a/baseline.zip'),
        workerClient.parse('after', aBytes, 'sample-a/candidate.zip'),
      ]);
      set((s) => ({
        before: { ...s.before, status: 'ready', trace: bTrace, progress: undefined },
        after: { ...s.after, status: 'ready', trace: aTrace, progress: undefined },
      }));
      await get().compare();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({
        before: { ...s.before, status: s.before.trace ? s.before.status : 'error', error: message },
        after: { ...s.after, status: s.after.trace ? s.after.status : 'error', error: message },
      }));
    }
  },

  async compare() {
    const { before, after, settings, manualOverrides, beforeRun, afterRun } = get();
    if (before.status !== 'ready' || after.status !== 'ready') return;
    set({ comparing: true, progress: 'starting', report: undefined, result: undefined });
    try {
      const res = await workerClient.compare(beforeRun, afterRun, settings, manualOverrides, (phase) =>
        set({ progress: phase }),
      );
      set({
        comparing: false,
        report: res.report,
        result: res.result,
        pixelDiffs: res.pixelDiffs,
        view: 'dashboard',
        progress: undefined,
      });
    } catch (err) {
      set({
        comparing: false,
        progress: undefined,
        after: { ...get().after, error: err instanceof Error ? err.message : String(err) },
      });
    }
  },

  updateSettings(partial) {
    set((s) => ({ settings: { ...s.settings, ...partial } }));
  },

  addManualOverride(o) {
    set((s) => ({ manualOverrides: [...s.manualOverrides, o] }));
  },

  removeManualOverride(o) {
    set((s) => ({
      manualOverrides: s.manualOverrides.filter(
        (m) => m.beforeId !== o.beforeId || m.afterId !== o.afterId,
      ),
    }));
  },

  viewReport(report) {
    // Reconstruct a view-only CompareResult shape so report-only viewing
    // renders without the original archives.
    set({
      report,
      result: {
        pairs: report.pairs,
        findings: report.findings,
        timingDeltas: [],
        requestPairs: [],
        screenshotPairs: [],
        limitations: report.limitations,
        summary: report.summary,
      },
      pixelDiffs: undefined,
      before: { status: 'ready', fileName: report.before.sourceLabel },
      after: { status: 'ready', fileName: report.after.sourceLabel },
      // Carry the saved settings so re-export reproduces the same report.
      settings: report.settings,
      view: 'dashboard',
    });
  },

  reset() {
    workerClient.cancelAll();
    set({
      before: empty,
      after: empty,
      report: undefined,
      result: undefined,
      pixelDiffs: undefined,
      manualOverrides: [],
      view: 'landing',
      comparing: false,
      progress: undefined,
    });
  },
}));
