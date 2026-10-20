import type { ComparisonSettings, ComparisonReport, NormalizedTrace } from '@sanestly/contracts';
import type { CompareResult, PixelDiffResult } from '@sanestly/analysis';
import type { ManualOverride } from '@sanestly/matcher';
import type { WorkerRequest } from './worker';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (phase: string) => void;
}

let worker: Worker | undefined;
let jobCounter = 0;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as Record<string, unknown> & { type: string; jobId: number };
      const p = pending.get(msg.jobId);
      if (msg.type === 'progress') {
        p?.onProgress?.(String(msg.phase));
        return;
      }
      if (!p) return;
      pending.delete(msg.jobId);
      if (msg.type === 'error') {
        p.reject(new Error(String(msg.message)));
      } else {
        p.resolve(msg);
      }
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || 'worker crashed');
      for (const [, p] of pending) p.reject(err);
      pending.clear();
      worker = undefined;
    };
  }
  return worker;
}

function call<T>(msg: WorkerRequest & { jobId: number }, onProgress?: (phase: string) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.set(msg.jobId, {
      resolve: resolve as (v: unknown) => void,
      reject,
      onProgress,
    });
    ensureWorker().postMessage(msg);
  });
}

export interface ParsedSide {
  side: 'before' | 'after';
  trace: NormalizedTrace;
}

export interface CompareResponse {
  report: ComparisonReport;
  result: CompareResult;
  pixelDiffs: PixelDiffResult[];
}

export const workerClient = {
  async parse(
    side: 'before' | 'after',
    bytes: ArrayBuffer,
    label: string,
    onProgress?: (phase: string) => void,
  ): Promise<NormalizedTrace> {
    const res = await call<{ trace: NormalizedTrace }>(
      { type: 'parse', jobId: ++jobCounter, side, bytes, label },
      onProgress,
    );
    return res.trace;
  },

  async compare(
    beforeRun: number,
    afterRun: number,
    settings?: Partial<ComparisonSettings>,
    manualOverrides?: ManualOverride[],
    onProgress?: (phase: string) => void,
  ): Promise<CompareResponse> {
    const res = await call<CompareResponse>(
      { type: 'compare', jobId: ++jobCounter, beforeRun, afterRun, settings, manualOverrides },
      onProgress,
    );
    return res;
  },

  async getResource(side: 'before' | 'after', path: string): Promise<Uint8Array | undefined> {
    const res = await call<{ bytes: ArrayBuffer | null }>({
      type: 'resource',
      jobId: ++jobCounter,
      side,
      path,
    });
    return res.bytes ? new Uint8Array(res.bytes) : undefined;
  },

  /**
   * Hard-cancel: archive parsing and comparison run synchronously inside
   * the worker, so the only way to actually abort them (and release their
   * memory) is to terminate the worker and lazily spawn a fresh one.
   */
  cancelAll(): void {
    if (worker) {
      worker.terminate();
      worker = undefined;
    }
    for (const [, p] of pending) p.reject(new Error('cancelled'));
    pending.clear();
  },

  dispose(): void {
    worker?.terminate();
    worker = undefined;
    pending.clear();
  },
};
