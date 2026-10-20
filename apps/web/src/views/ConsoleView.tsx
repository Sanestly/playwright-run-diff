import { useState } from 'react';
import { useStore } from '../state';
import { Card } from '../components';
import { EmptyState } from './Dashboard';

export function ConsoleView() {
  const { before, after, result } = useStore();
  const [level, setLevel] = useState('');

  if (!result) return <EmptyState text="No comparison yet - import two traces first." />;

  const bEvents = before.trace?.runs[0]?.consoleEvents ?? [];
  const aEvents = after.trace?.runs[0]?.consoleEvents ?? [];
  const bErr = before.trace?.runs[0]?.errors ?? [];
  const aErr = after.trace?.runs[0]?.errors ?? [];

  const filt = (list: typeof bEvents) =>
    level ? list.filter((e) => e.level.includes(level)) : list;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="rounded border border-gray-300 bg-transparent px-2 py-1.5 text-xs dark:border-gray-600"
          aria-label="Filter by level"
        >
          <option value="">all levels</option>
          <option value="error">error</option>
          <option value="warn">warn</option>
          <option value="log">log</option>
          <option value="info">info</option>
        </select>
        <span className="ml-auto text-xs text-gray-500">
          baseline {bEvents.length} events / {bErr.length} errors - candidate {aEvents.length} / {aErr.length}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold">Baseline console</h3>
          <EventList events={filt(bEvents)} errors={bErr} />
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold">Candidate console</h3>
          <EventList events={filt(aEvents)} errors={aErr} />
        </Card>
      </div>
    </div>
  );
}

function EventList({
  events,
  errors,
}: {
  events: Array<{ id: string; level: string; text: string; timeMs?: number }>;
  errors: Array<{ id: string; message: string }>;
}) {
  return (
    <div className="max-h-96 space-y-1 overflow-y-auto font-mono text-xs">
      {errors.map((e) => (
        <div key={e.id} className="rounded bg-red-50 px-2 py-1 text-red-800 dark:bg-red-950 dark:text-red-200">
          <span className="mr-2 font-sans font-semibold">ERROR</span>
          {e.message}
        </div>
      ))}
      {events.map((e) => (
        <div
          key={e.id}
          className={`rounded px-2 py-1 ${
            e.level === 'error'
              ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
              : e.level === 'warning' || e.level === 'warn'
                ? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                : 'bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          <span className="mr-2 text-gray-400">{e.timeMs !== undefined ? `${Math.round(e.timeMs)}ms` : ''}</span>
          {e.text}
        </div>
      ))}
      {events.length === 0 && errors.length === 0 && (
        <p className="text-gray-500">No console events recorded.</p>
      )}
    </div>
  );
}
