#!/usr/bin/env node
// Builds the pilot extension package and verifies it before anyone uploads it.
// Usage: WXT_API_BASE_URL=https://api.example.edu pnpm release:extension
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const EXPECTED_PERMISSIONS = ['alarms', 'notifications', 'scripting', 'storage'];
const PORTAL_HOST = 'https://portal.citd.edu.vn/*';

function fail(message) {
  process.stderr.write(`release-extension: ${message}\n`);
  process.exit(1);
}

const apiBaseUrl = process.env.WXT_API_BASE_URL;
if (!apiBaseUrl) {
  fail('set WXT_API_BASE_URL to the HTTPS URL of the staging or production API');
}
let api;
try {
  api = new URL(apiBaseUrl);
} catch {
  fail('WXT_API_BASE_URL is not a valid URL');
}
if (api.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(api.hostname)) {
  fail('release builds must use an HTTPS API URL that is not localhost');
}

const extensionDir = join(import.meta.dirname, '..', 'apps', 'extension');
const build = spawnSync('pnpm', ['exec', 'wxt', 'zip'], {
  cwd: extensionDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});
if (build.status !== 0) {
  fail('wxt zip failed');
}

const manifest = JSON.parse(
  readFileSync(join(extensionDir, '.output', 'chrome-mv3', 'manifest.json'), 'utf8'),
);
const version = JSON.parse(readFileSync(join(extensionDir, 'package.json'), 'utf8')).version;
const permissions = [...(manifest.permissions ?? [])].sort();
const hosts = [...(manifest.host_permissions ?? [])].sort();
const expectedHosts = [PORTAL_HOST, `${api.protocol}//${api.hostname}/*`].sort();

if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (manifest.version !== version)
  fail(`manifest version ${manifest.version} != package ${version}`);
if (JSON.stringify(permissions) !== JSON.stringify(EXPECTED_PERMISSIONS)) {
  fail(`unexpected permissions: ${permissions.join(', ')}`);
}
if (JSON.stringify(hosts) !== JSON.stringify(expectedHosts)) {
  fail(`unexpected host permissions: ${hosts.join(', ')}`);
}
if (permissions.includes('cookies') || hosts.some((host) => host.includes('<all_urls>'))) {
  fail('forbidden permission in manifest');
}

const zip = readdirSync(join(extensionDir, '.output')).find(
  (file) => file.endsWith('-chrome.zip') && file.includes(version),
);
if (!zip) fail('zip file not found');
const digest = createHash('sha256')
  .update(readFileSync(join(extensionDir, '.output', zip)))
  .digest('hex');

process.stdout.write(
  [
    `Extension ${version} packaged: apps/extension/.output/${zip}`,
    `SHA-256: ${digest}`,
    `API: ${api.origin}`,
    `Permissions: ${permissions.join(', ')}`,
    `Hosts: ${hosts.join(', ')}`,
    '',
  ].join('\n'),
);
