import { describe, expect, it } from 'vitest';
import { ConfigError, enabledLogLevels, LOCAL_DATABASE_URL, loadApiConfig } from './config.js';

describe('loadApiConfig', () => {
  it('uses local development defaults when variables are unset or empty', () => {
    const config = loadApiConfig({ API_PORT: '', AUTH_SECRET: '' });

    expect(config).toMatchObject({
      nodeEnv: 'development',
      logLevel: 'log',
      host: '127.0.0.1',
      port: 3000,
      database: { url: LOCAL_DATABASE_URL, poolMax: 10 },
      auth: { secretIsEphemeral: true, accessTokenTtlSeconds: 900, refreshTokenTtlDays: 30 },
    });
    expect(config.auth.secret.length).toBeGreaterThanOrEqual(32);
  });

  it('generates a different ephemeral secret for each process', () => {
    expect(loadApiConfig({}).auth.secret).not.toBe(loadApiConfig({}).auth.secret);
  });

  it('requires DATABASE_URL and AUTH_SECRET in production', () => {
    expect(() => loadApiConfig({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL: Required in production; AUTH_SECRET: Required in production/,
    );
  });

  it('rejects a short AUTH_SECRET without echoing it', () => {
    const load = () => loadApiConfig({ AUTH_SECRET: 'too-short-secret' });

    expect(load).toThrow(/AUTH_SECRET: Must be at least 32 characters/);
    expect(load).not.toThrow(/too-short-secret/);
  });

  it('rejects an invalid port and a non-Postgres database URL', () => {
    expect(() => loadApiConfig({ API_PORT: 'not-a-port' })).toThrow(ConfigError);
    expect(() => loadApiConfig({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL: Must be a postgresql:\/\/ URL/,
    );
  });
});

describe('Telegram configuration', () => {
  const telegram = {
    TELEGRAM_BOT_TOKEN: '123456789:test_token_not_real_test_token_not_real',
    TELEGRAM_BOT_USERNAME: 'CampusWatchBot',
    TELEGRAM_WEBHOOK_SECRET: 'w'.repeat(40),
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  };

  it('is disabled unless every Telegram variable is set', () => {
    expect(loadApiConfig({}).telegram).toBeNull();
    expect(loadApiConfig(telegram).telegram).toMatchObject({ botUsername: 'CampusWatchBot' });
  });

  it('rejects a partial Telegram configuration without echoing values', () => {
    const load = () => loadApiConfig({ TELEGRAM_BOT_TOKEN: telegram.TELEGRAM_BOT_TOKEN });
    expect(load).toThrow(/ENCRYPTION_KEY: Required when Telegram is enabled/);
    expect(load).not.toThrow(/test_token_not_real/);
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() => loadApiConfig({ ...telegram, ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(
      /ENCRYPTION_KEY: Must be 32 bytes/,
    );
  });
});

describe('enabledLogLevels', () => {
  it('enables the threshold and every more severe level', () => {
    expect(enabledLogLevels('warn')).toEqual(['fatal', 'error', 'warn']);
  });
});
