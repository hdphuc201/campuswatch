import { ConfigError, loadWorkerConfig } from './config.js';

/**
 * Validates the worker environment without connecting anywhere (deployment preflight).
 * Prints which optional features are enabled; never prints secret values.
 */
try {
  const config = loadWorkerConfig();
  const features = {
    environment: config.nodeEnv,
    telegram: config.telegram !== null,
    retention: config.retention,
  };
  process.stdout.write(`Worker configuration OK ${JSON.stringify(features)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof ConfigError ? error.message : 'Worker configuration could not be loaded'}\n`,
  );
  process.exitCode = 1;
}
