import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Command, CommandResult, ExtensionView, UserErrorCode } from '../messaging.js';

function send(command: Command): Promise<CommandResult> {
  return browser.runtime.sendMessage<Command, CommandResult>(command);
}

/** Popup state, always read from the background service worker (the single source of truth). */
export function useExtension() {
  const [view, setView] = useState<ExtensionView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserErrorCode>();

  const run = useCallback(async (command: Command) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await send(command);
      setView(result.view);
      if (!result.ok) {
        setError(result.error.code);
      }
    } catch {
      setError('unexpected');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // Initial load and every storage change: the background is the source of truth.
    const refresh = () =>
      void send({ type: 'getView' }).then(
        (result) => setView(result.view),
        () => setError('unexpected'),
      );
    refresh();
    browser.storage.onChanged.addListener(refresh);
    return () => browser.storage.onChanged.removeListener(refresh);
  }, []);

  return { view, busy, error, run };
}
