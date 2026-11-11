import {
  type Delivery,
  type DetailLevel,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreferences,
  type TelegramLinkStatus,
} from '@campuswatch/contracts';
import { useState } from 'react';

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  grades: 'Grades',
  tuition: 'Tuition',
  timetable: 'Timetable',
  exams: 'Exam schedule',
  notices: 'Portal notices',
};

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  chrome: 'Chrome',
  telegram: 'Telegram',
};

const STATUS_LABELS: Record<Delivery['status'], string> = {
  pending: 'Waiting',
  sending: 'Sending',
  sent: 'Delivered',
  failed: 'Failed',
  skipped: 'Not sent',
};

export function SettingsForm(props: {
  preferences: NotificationPreferences;
  busy: boolean;
  onSave: (preferences: NotificationPreferences) => void;
}) {
  const [draft, setDraft] = useState(props.preferences);
  const toggle = (channel: NotificationChannel, category: NotificationCategory) =>
    setDraft({
      ...draft,
      channels: {
        ...draft.channels,
        [channel]: { ...draft.channels[channel], [category]: !draft.channels[channel][category] },
      },
    });
  const setDetail = (channel: NotificationChannel, level: DetailLevel) =>
    setDraft({ ...draft, detailLevel: { ...draft.detailLevel, [channel]: level } });

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave(draft);
      }}
    >
      <h2>What to notify</h2>
      <table className="grid">
        <thead>
          <tr>
            <th scope="col">Category</th>
            {NOTIFICATION_CHANNELS.map((channel) => (
              <th key={channel} scope="col">
                {CHANNEL_LABELS[channel]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {NOTIFICATION_CATEGORIES.map((category) => (
            <tr key={category}>
              <th scope="row">{CATEGORY_LABELS[category]}</th>
              {NOTIFICATION_CHANNELS.map((channel) => (
                <td key={channel}>
                  <input
                    type="checkbox"
                    aria-label={`${CATEGORY_LABELS[category]} on ${CHANNEL_LABELS[channel]}`}
                    checked={draft.channels[channel][category]}
                    onChange={() => toggle(channel, category)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Message detail</h2>
      <p className="hint">
        Summary says only what kind of data changed (for example "1 grade update"). Detailed
        messages include course names, scores, and amounts.
      </p>
      {NOTIFICATION_CHANNELS.map((channel) => (
        <label key={channel}>
          {CHANNEL_LABELS[channel]}
          <select
            value={draft.detailLevel[channel]}
            onChange={(event) => setDetail(channel, event.target.value as DetailLevel)}
          >
            <option value="summary">Summary (recommended)</option>
            <option value="detailed">Detailed</option>
          </select>
        </label>
      ))}

      <h2>Quiet hours</h2>
      <p className="hint">
        Timetable, exam, and notice updates wait until quiet hours end. Grades and tuition are
        always sent right away.
      </p>
      <label className="inline">
        <input
          type="checkbox"
          checked={draft.quietHours !== null}
          onChange={() =>
            setDraft({
              ...draft,
              quietHours: draft.quietHours ? null : { start: '22:00', end: '07:00' },
            })
          }
        />
        Enable quiet hours
      </label>
      {draft.quietHours ? (
        <div className="row">
          <label>
            From
            <input
              type="time"
              value={draft.quietHours.start}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  quietHours: { ...draft.quietHours!, start: event.target.value },
                })
              }
            />
          </label>
          <label>
            To
            <input
              type="time"
              value={draft.quietHours.end}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  quietHours: { ...draft.quietHours!, end: event.target.value },
                })
              }
            />
          </label>
        </div>
      ) : null}
      <label>
        Time zone
        <input
          value={draft.timezone}
          onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
        />
      </label>

      <button type="submit" disabled={props.busy}>
        Save
      </button>
    </form>
  );
}

export function TelegramSection(props: {
  status: TelegramLinkStatus;
  busy: boolean;
  onLink: () => void;
  onUnlink: () => void;
}) {
  const { status } = props;
  if (!status.available) {
    return (
      <section className="stack">
        <h2>Telegram</h2>
        <p className="hint">Telegram notifications are not available yet.</p>
      </section>
    );
  }
  return (
    <section className="stack">
      <h2>Telegram</h2>
      {status.linked ? (
        <>
          <p>
            Linked
            {status.linkedAt ? ` since ${new Date(status.linkedAt).toLocaleDateString()}` : ''}.
          </p>
          <button type="button" disabled={props.busy} onClick={props.onUnlink}>
            Unlink Telegram
          </button>
        </>
      ) : (
        <>
          <p className="hint">
            Opens the CampusWatch bot with a one-time code (valid for 10 minutes). Press Start in
            Telegram to finish. You never need to enter a bot token or chat ID.
          </p>
          <button type="button" disabled={props.busy} onClick={props.onLink}>
            Link Telegram
          </button>
        </>
      )}
    </section>
  );
}

export function DeliveryList(props: { deliveries: Delivery[]; now: Date }) {
  if (props.deliveries.length === 0) {
    return <p className="hint">No notifications yet.</p>;
  }
  return (
    <table className="grid">
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">Category</th>
          <th scope="col">Channel</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {props.deliveries.map((delivery) => (
          <tr key={delivery.id}>
            <td>{new Date(delivery.createdAt).toLocaleString()}</td>
            <td>{CATEGORY_LABELS[delivery.category]}</td>
            <td>{CHANNEL_LABELS[delivery.channel]}</td>
            <td>
              {STATUS_LABELS[delivery.status]}
              {delivery.status === 'pending' &&
              Date.parse(delivery.deliverAfter) > props.now.getTime()
                ? ' (quiet hours)'
                : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
