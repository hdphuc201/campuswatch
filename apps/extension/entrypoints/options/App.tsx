import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Command, CommandResult, SettingsView, UserErrorCode } from '../../src/messaging.js';
import { DeliveryList, SettingsForm, TelegramSection } from '../../src/options/settings-form.js';
import { ERROR_MESSAGES } from '../../src/popup/status.js';

type SettingsCommand = Extract<
  Command,
  { type: 'getSettings' | 'savePreferences' | 'telegramLink' | 'telegramUnlink' }
>;

export function App() {
  const [settings, setSettings] = useState<SettingsView>();
  const [signedIn, setSignedIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserErrorCode>();
  const [saved, setSaved] = useState(false);

  const run = useCallback(async (command: SettingsCommand) => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const result = await browser.runtime.sendMessage<SettingsCommand, CommandResult>(command);
      setSignedIn(result.view.signedIn);
      if (result.ok) {
        setSettings(result.settings);
        setSaved(command.type === 'savePreferences');
      } else {
        setError(result.error.code);
      }
    } catch {
      setError('unexpected');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void browser.runtime.sendMessage<SettingsCommand, CommandResult>({ type: 'getSettings' }).then(
      (result) => {
        setSignedIn(result.view.signedIn);
        if (result.ok) {
          setSettings(result.settings);
        } else {
          setError(result.error.code);
        }
      },
      () => setError('unexpected'),
    );
  }, []);

  return (
    <main className="options">
      <h1>CampusWatch notification settings</h1>
      {error ? (
        <p className="error" role="alert">
          {ERROR_MESSAGES[error]}
        </p>
      ) : null}
      {saved ? (
        <p className="status status-ok" role="status">
          Saved.
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
        </>
      )}
    </main>
  );
}
