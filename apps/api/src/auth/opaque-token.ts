import { createHash, randomBytes } from 'node:crypto';

/** `cwr_` = refresh token, `cwd_` = device token. */
export type OpaqueTokenPrefix = 'cwr' | 'cwd';

/** 256-bit random token. Only its hash is stored. */
export function generateOpaqueToken(prefix: OpaqueTokenPrefix): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

/** SHA-256 hex digest used to look up a stored token. */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
