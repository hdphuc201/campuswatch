import { useState } from 'react';

/** Export and deletion. Each action asks for the CampusWatch password again. */
export function DataSection(props: {
  busy: boolean;
  onExport: (password: string) => void;
  onDeleteData: (password: string) => void;
  onDeleteAccount: (password: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const disabled = props.busy || password.length === 0;

  return (
    <section className="stack">
      <h2>Your data</h2>
      <p className="hint">
        Change history is kept for up to 12 months. Export downloads everything CampusWatch stores
        about you. Deleting your data removes your Portal connection, extracted data, change
        history, and notification settings; deleting your account also removes your sign-in.
      </p>
      <label>
        CampusWatch password (required for these actions)
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <div className="row">
        <button type="button" disabled={disabled} onClick={() => props.onExport(password)}>
          Export my data
        </button>
      </div>
      <label className="inline">
        <input type="checkbox" checked={confirmed} onChange={() => setConfirmed(!confirmed)} />I
        understand that deletion cannot be undone.
      </label>
      <div className="row">
        <button
          type="button"
          disabled={disabled || !confirmed}
          onClick={() => props.onDeleteData(password)}
        >
          Delete my data
        </button>
        <button
          type="button"
          disabled={disabled || !confirmed}
          onClick={() => props.onDeleteAccount(password)}
        >
          Delete my account
        </button>
      </div>
    </section>
  );
}
