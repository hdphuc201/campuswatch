import { describe, expect, it } from 'vitest';
import { JsonLogger, type LogLevelName } from './logger.js';
import { REDACTED, redact, redactString } from './redact.js';

const SECRETS = {
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXZhbHVl',
  refresh: 'cwr_AbCdEfGhIjKlMnOpQrStUvWx',
  device: 'cwd_ZyXwVuTsRqPoNmLkJiHgFeDc',
  bot: '123456789:test_token_not_real_test_token_not_real',
  email: 'student.name@example.edu',
  studentId: '2051234567',
  money: '9.800.000',
};

describe('redactString', () => {
  it('masks tokens, credentials, emails, IDs, money, cookies, CSRF values, and markup', () => {
    const input = [
      `Bearer ${SECRETS.jwt}`,
      SECRETS.refresh,
      SECRETS.device,
      `https://api.telegram.org/bot${SECRETS.bot}/sendMessage`,
      SECRETS.email,
      `MSSV ${SECRETS.studentId}`,
      `balance ${SECRETS.money}`,
      'Cookie: ASP.NET_SessionId=abc123def456',
      '__RequestVerificationToken=xyz987',
      '<td>8,5</td>',
    ].join(' | ');

    const output = redactString(input);

    for (const secret of Object.values(SECRETS)) {
      expect(output).not.toContain(secret);
    }
    expect(output).not.toMatch(/abc123def456|xyz987|<td>/);
    expect(output).toContain('Bearer [REDACTED]');
  });

  it('keeps ordinary operational text readable', () => {
    expect(redactString('sync completed in 230 ms for 5 sources (status 200)')).toBe(
      'sync completed in 230 ms for 5 sources (status 200)',
    );
  });
});

describe('redact', () => {
  it('drops sensitive keys at any depth and keeps safe ones', () => {
    const output = redact({
      method: 'POST',
      status: 401,
      user: { email: SECRETS.email, password: 'hunter2', id: 'abc' },
      headers: { authorization: `Bearer ${SECRETS.jwt}` },
      entity: { payload: { totalScore: 8.5 }, changedFields: [{ before: 7, after: 8.5 }] },
      tuition: { amountDue: 9_800_000, balance: 0 },
    });

    expect(output).toEqual({
      method: 'POST',
      status: 401,
      user: { email: REDACTED, password: REDACTED, id: 'abc' },
      headers: REDACTED,
      entity: { payload: REDACTED, changedFields: REDACTED },
      tuition: { amountDue: REDACTED, balance: REDACTED },
    });
  });

  it('keeps only name and redacted message of errors', () => {
    const error = new Error(`login failed for ${SECRETS.email}`);
    expect(redact({ error })).toEqual({
      error: { name: 'Error', message: `login failed for ${REDACTED}` },
    });
  });
});

describe('JsonLogger', () => {
  function capture(threshold: LogLevelName = 'log') {
    const lines: { line: string; level: LogLevelName }[] = [];
    const logger = new JsonLogger('test', threshold, (line, level) => lines.push({ line, level }));
    return { logger, lines };
  }

  it('writes one redacted JSON object per call with the Nest context', () => {
    const { logger, lines } = capture();
    logger.log(`device token ${SECRETS.device} used by ${SECRETS.email}`, 'AuthGuard');
    const record = JSON.parse(lines[0]!.line) as Record<string, unknown>;

    expect(record).toMatchObject({ level: 'log', service: 'test', context: 'AuthGuard' });
    expect(lines[0]!.line).not.toContain(SECRETS.device);
    expect(lines[0]!.line).not.toContain(SECRETS.email);
  });

  it('respects the level threshold', () => {
    const { logger, lines } = capture('warn');
    logger.log('hidden');
    logger.debug('hidden');
    logger.warn('shown');
    logger.error(new Error('also shown'));
    expect(lines.map((entry) => entry.level)).toEqual(['warn', 'error']);
  });

  it('redacts structured event fields', () => {
    const { logger, lines } = capture();
    logger.event('log', 'http_request', {
      method: 'GET',
      route: '/changes',
      status: 200,
      cookie: 'session=abc',
    });
    expect(JSON.parse(lines[0]!.line)).toMatchObject({
      message: 'http_request',
      route: '/changes',
      cookie: REDACTED,
    });
  });
});
