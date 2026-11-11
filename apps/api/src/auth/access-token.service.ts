import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import type { ApiConfig } from '../config.js';
import { API_CONFIG } from '../config.module.js';

const ISSUER = 'campuswatch-api';
const AUDIENCE = 'campuswatch';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccessTokenClaims {
  readonly userId: string;
  /** Refresh-token family the access token was issued for; revoking it revokes access. */
  readonly sessionFamilyId: string;
}

/** Short-lived HS256 JWT access tokens. */
@Injectable()
export class AccessTokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {
    this.key = new TextEncoder().encode(config.auth.secret);
  }

  async issue(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.config.auth.accessTokenTtlSeconds * 1000);
    const token = await new SignJWT({ sid: claims.sessionFamilyId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expiresAt };
  }

  /** Returns the claims of a valid token, or `null` for any invalid, expired, or forged token. */
  async verify(token: string): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      const { sub, sid } = payload;
      if (
        typeof sub !== 'string' ||
        typeof sid !== 'string' ||
        !UUID.test(sub) ||
        !UUID.test(sid)
      ) {
        return null;
      }
      return { userId: sub, sessionFamilyId: sid };
    } catch {
      return null;
    }
  }
}
