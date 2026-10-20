import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useStore } from '../state';
import { Card } from '../components';
import { EmptyState } from './Dashboard';
import { workerClient } from '../workerClient';

type Mode = 'side' | 'overlay' | 'blink' | 'diff' | 'mask';

interface MaskRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function VisualView() {
  const { result, pixelDiffs, settings, comparing, compare } = useStore();
  const [mode, setMode] = useState<Mode>('side');
  const reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!result) return <EmptyState text="No comparison yet - import two traces first." />;
  const pairs = result.screenshotPairs;
  const modes: Mode[] = reducedMotion ? ['side', 'overlay', 'diff', 'mask'] : ['side', 'overlay', 'blink', 'diff', 'mask'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="View mode">
        {modes.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded px-3 py-1.5 text-xs font-medium capitalize ${mode === m ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'bg-gray-100 dark:bg-gray-800'}`}
          >
            {m === 'side' ? 'Side by side' : m === 'diff' ? 'Diff only' : m}
          </button>
        ))}
        {settings.visuals.maskRects.length > 0 && (
          <button
            onClick={() => void compare()}
            disabled={comparing}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {comparing ? 'Re-running...' : `Apply ${settings.visuals.maskRects.length} mask(s) & re-run`}
          </button>
        )}
        <span className="ml-auto text-xs text-gray-500">{pairs.length} screenshot pairs</span>
      </div>

      {pairs.length === 0 && (
        <Card>
          <p className="text-sm text-gray-500">
            Screenshots not recorded in these traces - visual diff is not available. This is never
            treated as a pass.
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {pairs.map((p, i) => (
          <ShotCard key={i} pair={p} diff={pixelDiffs?.[i]} mode={mode} />
        ))}
      </div>
    </div>
  );
}

function ShotCard({
  pair,
  diff,
  mode,
}: {
  pair: { before?: { resourcePath: string }; after?: { resourcePath: string }; reason: string };
  diff?: { comparable: boolean; changedRatio?: number; changedPixels?: number; diffImage?: Uint8Array; reason?: string; width?: number; height?: number };
  mode: Mode;
}) {
  const { settings, updateSettings, manualMaskNotice } = useMasking();
  const [bUrl, setBUrl] = useState<string>();
  const [aUrl, setAUrl] = useState<string>();
  const [blink, setBlink] = useState(false);
  const [slider, setSlider] = useState(50);
  const diffCanvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const urls: string[] = [];
    let alive = true;
    (async () => {
      if (pair.before) {
        const bytes = await workerClient.getResource('before', pair.before.resourcePath);
        if (bytes && alive) {
          const u = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer]));
          urls.push(u);
          setBUrl(u);
        }
      }
      if (pair.after) {
        const bytes = await workerClient.getResource('after', pair.after.resourcePath);
        if (bytes && alive) {
          const u = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer]));
          urls.push(u);
          setAUrl(u);
        }
      }
    })();
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [pair.before?.resourcePath, pair.after?.resourcePath]);

  useEffect(() => {
    if (mode !== 'blink') return;
    const t = setInterval(() => setBlink((b) => !b), 600);
    return () => clearInterval(t);
  }, [mode]);

  useEffect(() => {
    if (mode === 'diff' && diff?.diffImage && diff.width && diff.height && diffCanvas.current) {
      const c = diffCanvas.current;
      c.width = diff.width;
      c.height = diff.height;
      const ctx = c.getContext('2d');
      if (ctx) {
        const img = ctx.createImageData(diff.width, diff.height);
        img.data.set(diff.diffImage);
        ctx.putImageData(img, 0, 0);
      }
    }
  }, [mode, diff]);

  const missing = !pair.before || !pair.after;

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-gray-500">{pair.reason}</span>
        {diff?.comparable ? (
          <span className={`font-medium ${(diff.changedRatio ?? 0) > 0.01 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600'}`}>
            {((diff.changedRatio ?? 0) * 100).toFixed(2)}% pixels changed ({diff.changedPixels})
          </span>
        ) : (
          <span className="text-gray-500">{diff?.reason ?? (missing ? 'not available on one side' : '')}</span>
        )}
      </div>

      {mode === 'side' && (
        <div className="grid grid-cols-2 gap-2">
          <Shot label="before" url={bUrl} />
          <Shot label="after" url={aUrl} />
        </div>
      )}
      {mode === 'overlay' && (
        <div className="relative">
          <div className="relative overflow-hidden rounded border border-gray-200 dark:border-gray-700">
            {bUrl && <img src={bUrl} alt="before" className="block w-full" />}
            {aUrl && (
              <img
                src={aUrl}
                alt="after"
                className="absolute inset-0 block w-full"
                style={{ clipPath: `inset(0 0 0 ${slider}%)` }}
              />
            )}
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={slider}
            onChange={(e) => setSlider(Number(e.target.value))}
            className="mt-2 w-full"
            aria-label="Overlay split position"
          />
        </div>
      )}
      {mode === 'blink' && (
        <div className="rounded border border-gray-200 dark:border-gray-700">
          {(blink ? aUrl : bUrl) ? (
            <img src={blink ? aUrl : bUrl} alt={blink ? 'after' : 'before'} className="block w-full" />
          ) : (
            <div className="p-8 text-center text-xs text-gray-500">screenshot not available</div>
          )}
        </div>
      )}
      {mode === 'diff' && (
        <div className="rounded border border-gray-200 dark:border-gray-700">
          {diff?.diffImage ? (
            <canvas ref={diffCanvas} className="block w-full" aria-label="pixel diff visualization" />
          ) : (
            <div className="p-8 text-center text-xs text-gray-500">{diff?.reason ?? 'no diff computed'}</div>
          )}
        </div>
      )}
      {mode === 'mask' && (
        <MaskEditor
          url={aUrl ?? bUrl}
          masks={settings.visuals.maskRects}
          onAdd={(r) =>
            updateSettings({ visuals: { ...settings.visuals, maskRects: [...settings.visuals.maskRects, r] } })
          }
          onRemove={(idx) =>
            updateSettings({
              visuals: {
                ...settings.visuals,
                maskRects: settings.visuals.maskRects.filter((_, i) => i !== idx),
              },
            })
          }
          notice={manualMaskNotice}
        />
      )}
    </Card>
  );
}

/** Shared masking helpers bound to the store. */
function useMasking() {
  const { settings, updateSettings } = useStore();
  return {
    settings,
    updateSettings,
    manualMaskNotice:
      'Drag on the image to mask a dynamic region (timestamps, animations). ' +
      'Masks apply to every pair and are saved in the exported report.',
  };
}

function MaskEditor({
  url,
  masks,
  onAdd,
  onRemove,
  notice,
}: {
  url?: string;
  masks: MaskRect[];
  onAdd: (r: MaskRect) => void;
  onRemove: (idx: number) => void;
  notice: string;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [draft, setDraft] = useState<MaskRect>();
  const start = useRef<{ x: number; y: number } | undefined>(undefined);

  const toImageCoords = (e: MouseEvent): { x: number; y: number } | undefined => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return undefined;
    const rect = img.getBoundingClientRect();
    const sx = img.naturalWidth / rect.width;
    const sy = img.naturalHeight / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    };
  };

  const down = (e: MouseEvent) => {
    const p = toImageCoords(e);
    if (!p) return;
    start.current = p;
    setDraft({ x: p.x, y: p.y, width: 0, height: 0 });
  };
  const move = (e: MouseEvent) => {
    if (!start.current) return;
    const p = toImageCoords(e);
    if (!p) return;
    setDraft({
      x: Math.min(start.current.x, p.x),
      y: Math.min(start.current.y, p.y),
      width: Math.abs(p.x - start.current.x),
      height: Math.abs(p.y - start.current.y),
    });
  };
  const up = () => {
    if (draft && draft.width >= 4 && draft.height >= 4) onAdd(draft);
    setDraft(undefined);
    start.current = undefined;
  };

  const pct = (r: MaskRect, img: HTMLImageElement | null) =>
    img && img.naturalWidth
      ? {
          left: `${(r.x / img.naturalWidth) * 100}%`,
          top: `${(r.y / img.naturalHeight) * 100}%`,
          width: `${(r.width / img.naturalWidth) * 100}%`,
          height: `${(r.height / img.naturalHeight) * 100}%`,
        }
      : { left: 0, top: 0, width: 0, height: 0 };

  return (
    <div>
      <p className="mb-2 text-xs text-gray-500">{notice}</p>
      <div
        className="relative inline-block w-full cursor-crosshair select-none rounded border border-gray-200 dark:border-gray-700"
        onMouseDown={down}
        onMouseMove={move}
        onMouseUp={up}
        onMouseLeave={() => {
          setDraft(undefined);
          start.current = undefined;
        }}
      >
        {url ? (
          <img ref={imgRef} src={url} alt="candidate screenshot - draw mask regions" className="block w-full" draggable={false} />
        ) : (
          <div className="p-8 text-center text-xs text-gray-500">screenshot not available</div>
        )}
        {imgRef.current &&
          masks.map((m, i) => (
            <button
              key={i}
              aria-label={`remove mask ${i + 1}`}
              title="click to remove mask"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(i);
              }}
              className="absolute border-2 border-red-500/80 bg-red-500/25"
              style={pct(m, imgRef.current)}
            />
          ))}
        {draft && imgRef.current && (
          <div className="absolute border-2 border-dashed border-blue-500 bg-blue-500/20" style={pct(draft, imgRef.current)} />
        )}
      </div>
      {masks.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-gray-500">
          {masks.map((m, i) => (
            <li key={i}>
              mask {i + 1}: x={Math.round(m.x)} y={Math.round(m.y)} {Math.round(m.width)}x{Math.round(m.height)}
              <button onClick={() => onRemove(i)} className="ml-2 text-red-600 underline dark:text-red-400">
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Shot({ label, url }: { label: string; url?: string }) {
  return (
    <figure className="overflow-hidden rounded border border-gray-200 dark:border-gray-700">
      {url ? (
        <img src={url} alt={`${label} screenshot`} className="block w-full" />
      ) : (
        <div className="p-8 text-center text-xs text-gray-500">not available</div>
      )}
      <figcaption className="bg-gray-50 px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-800">
        {label}
      </figcaption>
    </figure>
  );
}
