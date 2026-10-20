import { useEffect } from 'react';
import { useStore, type View } from './state';
import { Landing } from './views/Landing';
import { Dashboard } from './views/Dashboard';
import { ActionsView } from './views/ActionsView';
import { NetworkView } from './views/NetworkView';
import { VisualView } from './views/VisualView';
import { ConsoleView } from './views/ConsoleView';
import { SettingsView } from './views/SettingsView';
import { HelpView } from './views/HelpView';

const TABS: Array<{ id: View; label: string; needsReport?: boolean }> = [
  { id: 'landing', label: 'Import' },
  { id: 'dashboard', label: 'Dashboard', needsReport: true },
  { id: 'actions', label: 'Actions', needsReport: true },
  { id: 'network', label: 'Network', needsReport: true },
  { id: 'visual', label: 'Visual', needsReport: true },
  { id: 'console', label: 'Console & Errors', needsReport: true },
  { id: 'settings', label: 'Settings & Export' },
  { id: 'help', label: 'Help' },
];

export function App() {
  const { view, setView, dark, report, toggleDark, reset, comparing, progress } = useStore();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-gray-900 focus:px-3 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <div aria-live="polite" className="sr-only">
        {comparing ? `Comparing - ${progress ?? 'working'}` : ''}
      </div>
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold tracking-tight">Sanestly</span>
            <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">Playwright Run Diff</span>
          </div>
          <nav className="ml-4 flex flex-1 gap-1 overflow-x-auto" aria-label="Main">
            {TABS.map((t) => {
              const disabled = t.needsReport && !report;
              return (
                <button
                  key={t.id}
                  onClick={() => setView(t.id)}
                  disabled={disabled}
                  aria-current={view === t.id ? 'page' : undefined}
                  className={`rounded px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    view === t.id
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : disabled
                        ? 'cursor-not-allowed text-gray-300 dark:text-gray-600'
                        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
          <span className="hidden items-center gap-1.5 rounded-full border border-emerald-300 px-2.5 py-0.5 text-xs text-emerald-700 lg:inline-flex dark:border-emerald-700 dark:text-emerald-300">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            Local processing - traces not uploaded
          </span>
          {comparing && <span className="text-xs text-blue-600 dark:text-blue-400">{progress ?? 'working...'}</span>}
          <button onClick={toggleDark} className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600" aria-label="Toggle dark mode">
            {dark ? 'Light' : 'Dark'}
          </button>
          <button onClick={reset} className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600">
            Reset
          </button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6">
        {view === 'landing' && <Landing />}
        {view === 'dashboard' && <Dashboard />}
        {view === 'actions' && <ActionsView />}
        {view === 'network' && <NetworkView />}
        {view === 'visual' && <VisualView />}
        {view === 'console' && <ConsoleView />}
        {view === 'settings' && <SettingsView />}
        {view === 'help' && <HelpView />}
      </main>
      <footer className="border-t border-gray-200 py-4 text-center text-xs text-gray-500 dark:border-gray-800">
        Sanestly Playwright Run Diff - an open-source trace comparison tool. Not affiliated with Playwright or Microsoft.
      </footer>
    </div>
  );
}
