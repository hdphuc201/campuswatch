import { describe, expect, it } from 'vitest';
import { ConfigError, enabledLogLevels, loadApiConfig } from './config.js';

describe('loadApiConfig', () => {
  it('uses local development defaults when variables are unset or empty', () => {
    expect(loadApiConfig({ API_PORT: '' })).toEqual({
      nodeEnv: 'development',
      logLevel: 'log',
      host: '127.0.0.1',
      port: 3000,
    });
  });

  it('rejects an invalid port without echoing the value', () => {
    expect(() => loadApiConfig({ API_PORT: 'not-a-port' })).toThrow(ConfigError);
    expect(() => loadApiConfig({ API_PORT: 'not-a-port' })).not.toThrow(/not-a-port/);
  });
});

describe('enabledLogLevels', () => {
  it('enables the threshold and every more severe level', () => {
    expect(enabledLogLevels('warn')).toEqual(['fatal', 'error', 'warn']);
  });
});
