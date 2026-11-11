import { browser } from 'wxt/browser';
import { AuthForm, ConsentView, Dashboard, RecentChanges } from '../../src/popup/components.js';
import { ERROR_MESSAGES } from '../../src/popup/status.js';
import { useExtension } from '../../src/popup/use-extension.js';

export function App() {
  const { view, busy, error, changes, run } = useExtension();

  return (
    <main className="popup">
      <h1>CampusWatch</h1>
      {error ? (
        <p className="error" role="alert">
          {ERROR_MESSAGES[error]}
        </p>
      ) : null}
      {!view ? (
        <p className="hint">Loading…</p>
      ) : !view.signedIn ? (
        <AuthForm busy={busy} onSubmit={(command) => void run(command)} />
      ) : !view.connection ? (
        <ConsentView
          busy={busy}
          onAccept={() => void run({ type: 'connect' })}
          onSignOut={() => void run({ type: 'signOut' })}
        />
      ) : (
        <>
          <Dashboard
            view={view}
            now={new Date()}
            busy={busy}
            onCommand={(c) => void run(c)}
            onOpenSettings={() => void browser.runtime.openOptionsPage()}
          />
          <RecentChanges changes={changes} now={new Date()} />
        </>
      )}
    </main>
  );
}
