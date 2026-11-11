import { describe, expect, it } from 'vitest';
import { loadApiConfig } from '../config.js';
import { AccessTokenService } from './access-token.service.js';
import { generateOpaqueToken, hashOpaqueToken } from './opaque-token.js';
import { PasswordHasher } from './password-hasher.js';

const USER_ID = '6f1c2b0e-8a4d-4c1e-9f3a-2b7d5e8c9a10';
const FAMILY_ID = '0b9e7c4a-1d2f-4e3b-8a5c-6d7e8f9a0b1c';

const config = (secret: string) => loadApiConfig({ NODE_ENV: 'test', AUTH_SECRET: secret });

describe('opaque tokens', () => {
  it('are prefixed, unique, and hashed deterministically', () => {
    const token = generateOpaqueToken('cwd');

    expect(token).toMatch(/^cwd_[A-Za-z0-9_-]{43}$/);
    expect(generateOpaqueToken('cwd')).not.toBe(token);
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
    expect(hashOpaqueToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AccessTokenService', () => {
  const service = new AccessTokenService(config('a'.repeat(32)));

  it('round-trips claims and expires after the configured TTL', async () => {
    const { token, expiresAt } = await service.issue({
      userId: USER_ID,
      sessionFamilyId: FAMILY_ID,
    });

    await expect(service.verify(token)).resolves.toEqual({
      userId: USER_ID,
      sessionFamilyId: FAMILY_ID,
    });
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(890 * 1000);
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(900 * 1000);
  });

  it('rejects tokens signed with another secret, tampered tokens, and garbage', async () => {
    const { token } = await new AccessTokenService(config('b'.repeat(32))).issue({
      userId: USER_ID,
      sessionFamilyId: FAMILY_ID,
    });
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: USER_ID, sid: FAMILY_ID, exp: 9999999999 }),
    ).toString('base64url');

    await expect(service.verify(token)).resolves.toBeNull();
    await expect(service.verify(`${header}.${forgedPayload}.${signature}`)).resolves.toBeNull();
    await expect(service.verify('not-a-jwt')).resolves.toBeNull();
  });

  it('rejects unsigned (alg: none) tokens', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      sub: USER_ID,
      sid: FAMILY_ID,
      iss: 'campuswatch-api',
      aud: 'campuswatch',
      exp: 9999999999,
    })}.`;

    await expect(service.verify(unsigned)).resolves.toBeNull();
  });
});

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('uses argon2id with OWASP parameters and verifies correctly', async () => {
    const passwordHash = await hasher.hash('correct horse battery staple');

    expect(passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(hasher.verify(passwordHash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(hasher.verify(passwordHash, 'wrong password')).resolves.toBe(false);
  });

  it('always fails the dummy verification', async () => {
    await expect(hasher.verifyAgainstDummy('campuswatch-dummy-password')).resolves.toBe(false);
  });
});
