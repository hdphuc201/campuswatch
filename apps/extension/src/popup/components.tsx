import { type FormEvent, useState } from 'react';
import { type ChangeEvent, PASSWORD_MIN_LENGTH } from '@campuswatch/contracts';
import type { Command, ExtensionView } from '../messaging.js';
import { describeChange } from './changes.js';
import { describeStatus, formatRelative } from './status.js';

export function AuthForm(props: {
  busy: boolean;
  onSubmit: (command: Extract<Command, { type: 'signIn' | 'register' }>) => void;
}) {
  const [mode, setMode] = useState<'signIn' | 'register'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit({ type: mode, email, password });
  };

  return (
    <form className="stack" onSubmit={submit}>
      <h2>{mode === 'signIn' ? 'Sign in to CampusWatch' : 'Create a CampusWatch account'}</h2>
      <p className="hint">
        This is your CampusWatch account, not your CITD Portal password. Never enter your Portal
        password here.
      </p>
      <label>
        Email
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'register' ? PASSWORD_MIN_LENGTH : 1}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button type="submit" disabled={props.busy}>
        {mode === 'signIn' ? 'Sign in' : 'Create account'}
      </button>
      <button
        type="button"
        className="link"
        onClick={() => setMode(mode === 'signIn' ? 'register' : 'signIn')}
      >
        {mode === 'signIn' ? 'New here? Create an account' : 'Already have an account? Sign in'}
      </button>
    </form>
  );
}

/** Consent text. Bump CONSENT_VERSION in src/config.ts whenever it changes. */
export function ConsentView(props: { busy: boolean; onAccept: () => void; onSignOut: () => void }) {
  return (
    <section className="stack">
      <h2>Connect your CITD Portal</h2>
      <ul className="consent">
        <li>
          <strong>What is read:</strong> your grades, tuition, timetable, exam schedule, and
          Dashboard notices, from the Portal you are already logged in to in Chrome.
        </li>
        <li>
          <strong>When:</strong> about every 30 minutes, only while Chrome is running. Nothing is
          checked while Chrome or your computer is off.
        </li>
        <li>
          <strong>Never collected:</strong> your Portal password, cookies, or page contents.
          CampusWatch never logs in for you and never changes anything in the Portal.
        </li>
        <li>
          <strong>Stored:</strong> the extracted data and its change history, on CampusWatch
          servers, for up to 12 months.
        </li>
        <li>
          <strong>Your control:</strong> pause, disconnect, or delete your data at any time.
        </li>
      </ul>
      <button type="button" disabled={props.busy} onClick={props.onAccept}>
        I agree, connect
      </button>
      <button type="button" className="link" onClick={props.onSignOut}>
        Sign out
      </button>
    </section>
  );
}

export function Dashboard(props: {
  view: ExtensionView;
  now: Date;
  busy: boolean;
  onCommand: (command: Command) => void;
}) {
  const { view, now, busy, onCommand } = props;
  const status = describeStatus(view, now);
  const paused = view.connection?.status === 'PAUSED';
  const syncBlocked =
    busy || paused || !view.adapterAvailable || Boolean(view.manualSyncAvailableAt);

  return (
    <section className="stack">
      <div className={`status status-${status.tone}`} role="status">
        <strong>{status.title}</strong>
        <span>{status.detail}</span>
      </div>
      <dl>
        <dt>Account</dt>
        <dd>{view.email}</dd>
        <dt>Last attempt</dt>
        <dd>{formatRelative(view.sync.lastAttemptAt, now)}</dd>
        {view.sync.nextRunAt && !paused ? (
          <>
            <dt>Next check</dt>
            <dd>{new Date(view.sync.nextRunAt).toLocaleTimeString()}</dd>
          </>
        ) : null}
      </dl>
      <div className="row">
        <button type="button" disabled={syncBlocked} onClick={() => onCommand({ type: 'syncNow' })}>
          Sync now
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onCommand({ type: paused ? 'resume' : 'pause' })}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>
      {view.manualSyncAvailableAt ? (
        <p className="hint">
          Manual sync available again at {new Date(view.manualSyncAvailableAt).toLocaleTimeString()}
          .
        </p>
      ) : null}
      <p className="hint">CampusWatch only checks while Chrome is running.</p>
      {view.adapterBeta ? (
        <p className="hint">
          Portal reading is in beta: if something looks wrong, check the Portal directly.
        </p>
      ) : null}
      <div className="row">
        <button type="button" className="link" onClick={() => onCommand({ type: 'disconnect' })}>
          Disconnect Portal
        </button>
        <button type="button" className="link" onClick={() => onCommand({ type: 'signOut' })}>
          Sign out
        </button>
      </div>
    </section>
  );
}

export function RecentChanges(props: { changes: ChangeEvent[] | undefined; now: Date }) {
  if (!props.changes) {
    return null;
  }
  return (
    <section className="stack">
      <h2>Recent changes</h2>
      {props.changes.length === 0 ? (
        <p className="hint">No changes yet. The first sync records your current data.</p>
      ) : (
        <ul className="changes">
          {props.changes.map((change) => {
            const { title, details } = describeChange(change);
            return (
              <li key={change.id}>
                <strong>{title}</strong>
                {details.map((detail) => (
                  <span key={detail}>{detail}</span>
                ))}
                <time dateTime={change.createdAt}>
                  {formatRelative(change.createdAt, props.now)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
