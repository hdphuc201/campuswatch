import { ConfigError, loadApiConfig } from './config.js';

/**
 * Validates the API environment without starting the server (deployment preflight).
 * Prints which optional features are enabled; never prints secret values.
 */
try {
  const config = loadApiConfig();
  const features = {
    environment: config.nodeEnv,
    sharedRateLimits: config.redisUrl !== null,
    telegram: config.telegram !== null,
    opsMetrics: config.opsMetricsToken !== null,
    trustedProxyHops: config.trustProxyHops,
  };
  process.stdout.write(`API configuration OK ${JSON.stringify(features)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof ConfigError ? error.message : 'API configuration could not be loaded'}\n`,
  );
  process.exitCode = 1;
}
