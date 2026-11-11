import { describe, expect, it } from 'vitest';
import { ConfigError, loadWorkerConfig } from './config.js';

describe('loadWorkerConfig', () => {
  it('falls back to local Redis outside production', () => {
    expect(loadWorkerConfig({ REDIS_URL: '' })).toEqual({
      nodeEnv: 'development',
      logLevel: 'log',
      redis: { host: '127.0.0.1', port: 6379, db: 0 },
    });
  });

  it('requires REDIS_URL in production', () => {
    expect(() => loadWorkerConfig({ NODE_ENV: 'production' })).toThrow(
      /REDIS_URL: Required in production/,
    );
  });

  it('parses credentials, database index, and TLS from the URL', () => {
    const config = loadWorkerConfig({
      NODE_ENV: 'production',
      REDIS_URL: 'rediss://worker:p%40ss@redis.internal:6380/2',
    });

    expect(config.redis).toEqual({
      host: 'redis.internal',
      port: 6380,
      db: 2,
      username: 'worker',
      password: 'p@ss',
      tls: {},
    });
  });

  it('rejects non-Redis URLs without echoing them', () => {
    const load = () => loadWorkerConfig({ REDIS_URL: 'https://user:hunter2@example.com' });

    expect(load).toThrow(ConfigError);
    expect(load).not.toThrow(/hunter2/);
  });

  it('rejects an invalid database index', () => {
    expect(() => loadWorkerConfig({ REDIS_URL: 'redis://localhost:6379/abc' })).toThrow(
      /Invalid database index/,
    );
  });
});
