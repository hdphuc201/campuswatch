import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export function fixtureHtml(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

export function fixture(name: string): Document {
  return new DOMParser().parseFromString(fixtureHtml(name), 'text/html');
}

export function html(body: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body>${body}</body></html>`,
    'text/html',
  );
}
