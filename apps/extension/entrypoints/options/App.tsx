import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Command, CommandResult, SettingsView, UserErrorCode } from '../../src/messaging.js';
import { DataSection } from '../../src/options/data-section.js';
import { DeliveryList, SettingsForm, TelegramSection } from '../../src/options/settings-form.js';
import { ERROR_MESSAGES } from '../../src/popup/status.js';

type OptionsCommand = Extract<
  Command,
  {
    type:
      | 'getSettings'
      | 'savePreferences'
      | 'telegramLink'
      | 'telegramUnlink'
      | 'exportData'
      | 'deleteData'
      | 'deleteAccount';
  }
>;

const SUCCESS: Partial<Record<OptionsCommand['type'], string>> = {
  savePreferences: 'Saved.',
  exportData: 'Your data was downloaded.',
  deleteData: 'Your data was deleted.',
  deleteAccount: 'Your account was deleted.',
};

function download(data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `campuswatch-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

const send = (command: OptionsCommand) =>
  browser.runtime.sendMessage<OptionsCommand, CommandResult>(command);

export function App() {
  const [settings, setSettings] = useState<SettingsView>();
  const [signedIn, setSignedIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserErrorCode>();
  const [notice, setNotice] = useState<string>();

  const apply = useCallback((command: OptionsCommand, result: CommandResult) => {
    setSignedIn(result.view.signedIn);
    if (!result.ok) {
      setError(result.error.code);
      return;
    }
    if (result.settings) {
      setSettings(result.settings);
    }
    if (result.export) {
      download(result.export);
    }
    setNotice(SUCCESS[command.type]);
  }, []);

  const run = useCallback(
    async (command: OptionsCommand) => {
      setBusy(true);
      setError(undefined);
      setNotice(undefined);
      try {
        apply(command, await send(command));
        if (command.type === 'deleteData') {
          apply({ type: 'getSettings' }, await send({ type: 'getSettings' }));
          setNotice(SUCCESS.deleteData);
        }
      } catch {
        setError('unexpected');
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  useEffect(() => {
    void send({ type: 'getSettings' }).then(
      (result) => apply({ type: 'getSettings' }, result),
      () => setError('unexpected'),
    );
  }, [apply]);

  return (
    <main className="options">
      <h1>CampusWatch settings</h1>
      {error ? (
        <p className="error" role="alert">
          {ERROR_MESSAGES[error]}
        </p>
      ) : null}
      {notice ? (
        <p className="status status-ok" role="status">
          {notice}
        </p>
      ) : null}
      {!signedIn ? (
        <p>Sign in from the CampusWatch toolbar button first.</p>
      ) : !settings ? (
        <p className="hint">Loading…</p>
      ) : (
        <>
          <SettingsForm
            key={JSON.stringify(settings.preferences)}
            preferences={settings.preferences}
            busy={busy}
            onSave={(preferences) => void run({ type: 'savePreferences', preferences })}
          />
          <TelegramSection
            status={settings.telegram}
            busy={busy}
            onLink={() => void run({ type: 'telegramLink' })}
            onUnlink={() => void run({ type: 'telegramUnlink' })}
          />
          <section className="stack">
            <h2>Recent notifications</h2>
            <DeliveryList deliveries={settings.deliveries} now={new Date()} />
          </section>
          <DataSection
            busy={busy}
            onExport={(password) => void run({ type: 'exportData', password })}
            onDeleteData={(password) => void run({ type: 'deleteData', password })}
            onDeleteAccount={(password) => void run({ type: 'deleteAccount', password })}
          />
        </>
      )}
    </main>
  );
}
