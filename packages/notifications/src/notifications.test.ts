import { randomBytes } from 'node:crypto';
import type { ChangeEvent } from '@campuswatch/contracts';
import { describe, expect, it } from 'vitest';
import { deliverAfter, isQuiet } from './quiet-hours.js';
import { isNotifiable } from './policy.js';
import { renderNotification } from './render.js';
import { createChatIdCipher, secretsEqual } from './server/crypto.js';
import {
  createHttpTelegramClient,
  parseStartCommand,
  TelegramApiError,
} from './server/telegram.js';

const change = (patch: Partial<ChangeEvent>): ChangeEvent => ({
  id: '00000000-0000-4000-8000-000000000001',
  connectionId: '00000000-0000-4000-8000-000000000002',
  createdAt: '2026-11-11T07:00:00.000Z',
  entityType: 'grade_course',
  externalKey: 'k',
  kind: 'UPDATED',
  changedFields: [{ field: 'totalScore', before: 7.9, after: 8.4 }],
  payload: { courseCode: 'CS101', courseName: 'Nhập môn lập trình', totalScore: 8.4 },
  ...patch,
});

describe('renderNotification', () => {
  const batch = [
    change({}),
    change({
      entityType: 'tuition_term',
      changedFields: [{ field: 'balance', before: 5_500_000, after: 0 }],
      payload: { academicYear: '2025-2026', semester: '2', balance: 0 },
    }),
    change({
      entityType: 'exam',
      kind: 'ADDED',
      changedFields: [],
      payload: { courseCode: 'EN101' },
    }),
  ];

  it('summary mode lists categories and counts only: no names, scores, or amounts', () => {
    const rendered = renderNotification(batch, 'summary');
    expect(rendered).toEqual({
      title: 'CampusWatch: 3 updates',
      body: '1 grade update, 1 tuition update, 1 exam schedule change. Open CampusWatch to see the details.',
    });
    expect(JSON.stringify(rendered)).not.toMatch(/CS101|EN101|8\.4|7\.9|5\.500\.000|Nhập/);
  });

  it('detailed mode lists each change with values (opt-in)', () => {
    const { body } = renderNotification(batch, 'detailed');
    expect(body.split('\n')).toEqual([
      'Updated: CS101 Nhập môn lập trình (Total score: 7.9 → 8.4)',
      `Updated: Tuition 2025-2026 semester 2 (Balance: ${(5_500_000).toLocaleString('vi-VN')} ₫ → 0 ₫)`,
      'New: Exam EN101',
    ]);
  });

  it('caps detailed lists', () => {
    const many = Array.from({ length: 12 }, () => change({}));
    const lines = renderNotification(many, 'detailed').body.split('\n');
    expect(lines).toHaveLength(11);
    expect(lines.at(-1)).toBe('…and 2 more.');
  });
});

describe('policy', () => {
  it('notifies notices only when they appear', () => {
    expect(isNotifiable({ entityType: 'portal_notice', kind: 'ADDED' })).toBe(true);
    expect(isNotifiable({ entityType: 'portal_notice', kind: 'UPDATED' })).toBe(false);
    expect(isNotifiable({ entityType: 'grade_course', kind: 'REMOVED' })).toBe(true);
  });
});

describe('quiet hours', () => {
  const overnight = { start: '22:00', end: '07:00' };
  const tz = 'Asia/Ho_Chi_Minh'; // UTC+7, no DST

  it('detects quiet time across midnight in the user time zone', () => {
    expect(isQuiet(new Date('2026-11-11T16:30:00Z'), overnight, tz)).toBe(true); // 23:30 local
    expect(isQuiet(new Date('2026-11-11T23:00:00Z'), overnight, tz)).toBe(true); // 06:00 local
    expect(isQuiet(new Date('2026-11-12T00:00:00Z'), overnight, tz)).toBe(false); // 07:00 local
    expect(isQuiet(new Date('2026-11-11T05:00:00Z'), overnight, tz)).toBe(false); // 12:00 local
  });

  it('delays non-urgent notifications to the end of quiet hours, never urgent ones', () => {
    const at2330 = new Date('2026-11-11T16:30:00Z');
    expect(deliverAfter(at2330, { urgent: false, quietHours: overnight, timeZone: tz })).toEqual(
      new Date('2026-11-12T00:00:00Z'),
    );
    expect(deliverAfter(at2330, { urgent: true, quietHours: overnight, timeZone: tz })).toEqual(
      at2330,
    );
    expect(deliverAfter(at2330, { urgent: false, quietHours: null, timeZone: tz })).toEqual(at2330);
  });

  it('works in time zones with daylight saving', () => {
    // 23:00 in New York on a winter day (UTC-5) → quiet until 07:00 local = 12:00 UTC.
    const instant = new Date('2026-01-15T04:00:00Z');
    expect(
      deliverAfter(instant, { urgent: false, quietHours: overnight, timeZone: 'America/New_York' }),
    ).toEqual(new Date('2026-01-15T12:00:00Z'));
  });
});

describe('chat id encryption', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips, uses a fresh IV, and hashes deterministically', () => {
    const cipher = createChatIdCipher(key);
    const a = cipher.encrypt('123456789');
    const b = cipher.encrypt('123456789');
    expect(a).not.toBe(b);
    expect(a).not.toContain('123456789');
    expect(cipher.decrypt(a)).toBe('123456789');
    expect(cipher.hash('123456789')).toBe(cipher.hash('123456789'));
    expect(cipher.hash('123456789')).not.toBe(cipher.hash('987654321'));
  });

  it('rejects tampering and other keys', () => {
    const cipher = createChatIdCipher(key);
    const value = cipher.encrypt('123456789');
    const parts = value.split('.');
    parts[2] = Buffer.from('999999999').toString('base64url');
    expect(() => cipher.decrypt(parts.join('.'))).toThrow();
    expect(() => createChatIdCipher(randomBytes(32).toString('base64')).decrypt(value)).toThrow();
    expect(() => createChatIdCipher(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });

  it('compares secrets in constant time', () => {
    expect(secretsEqual('abc', 'abc')).toBe(true);
    expect(secretsEqual('abd', 'abc')).toBe(false);
    expect(secretsEqual(undefined, 'abc')).toBe(false);
  });
});

describe('telegram', () => {
  it('parses one-time link codes only', () => {
    expect(parseStartCommand('/start abcdefghijklmnop_-123456')).toBe('abcdefghijklmnop_-123456');
    expect(parseStartCommand('/start@CampusWatchBot abcdefghijklmnop')).toBe('abcdefghijklmnop');
    expect(parseStartCommand('/start')).toBeNull();
    expect(parseStartCommand('/start short')).toBeNull();
    expect(parseStartCommand('/start abc; drop table users')).toBeNull();
  });

  it('never leaks the bot token in errors', async () => {
    const token = '123456:SECRET-TOKEN';
    const client = createHttpTelegramClient(token, () =>
      Promise.resolve(
        new Response(JSON.stringify({ description: `Forbidden for bot${token}` }), { status: 403 }),
      ),
    );
    const error = await client.sendMessage('1', 'hi').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramApiError);
    expect((error as TelegramApiError).chatGone).toBe(true);
    expect(String((error as Error).message)).not.toContain('SECRET-TOKEN');
  });
});
