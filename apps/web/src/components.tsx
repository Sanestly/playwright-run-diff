import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { Severity } from '@sanestly/contracts';

export function SeverityBadge({ severity }: { severity: Severity | string }) {
  const colors: Record<string, string> = {
    critical: 'bg-red-700 text-white',
    high: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    low: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    info: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium uppercase ${colors[severity] ?? colors.info}`}>
      {severity}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    added: 'text-emerald-700 dark:text-emerald-300',
    removed: 'text-red-700 dark:text-red-300',
    changed: 'text-amber-700 dark:text-amber-300',
    unchanged: 'text-gray-500',
    unmatched: 'text-gray-500',
  };
  return <span className={`text-xs font-medium ${colors[status] ?? 'text-gray-500'}`}>{status}</span>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900 ${className}`}>
      {children}
    </div>
  );
}

export function DropZone({
  label,
  status,
  error,
  progress,
  onFile,
}: {
  label: string;
  status: string;
  error?: string;
  progress?: string;
  onFile: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  const border =
    status === 'error'
      ? 'border-red-400'
      : status === 'ready'
        ? 'border-emerald-400'
        : dragging
          ? 'border-blue-400 bg-blue-50 dark:bg-blue-950'
          : 'border-gray-300 dark:border-gray-600';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label} - drop a Playwright trace .zip or press Enter to browse`}
      className={`flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 text-center transition-colors ${border}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {status === 'loading' && (progress ?? 'processing...')}
        {status === 'ready' && 'parsed - ready to compare'}
        {status === 'error' && <span className="text-red-600 dark:text-red-400">{error}</span>}
        {status === 'empty' && 'drop .zip trace or click to browse'}
      </div>
    </div>
  );
}
