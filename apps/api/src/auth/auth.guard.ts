import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DATABASE, type Database } from '../database/database.module.js';
import { authSessions, devices } from '@campuswatch/db';
import { AccessTokenService } from './access-token.service.js';
import { hashOpaqueToken } from './opaque-token.js';
import {
  AUTH_MODE_KEY,
  type AuthMode,
  type Principal,
  type RequestWithPrincipal,
} from './principal.js';

function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') {
    return null;
  }
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1] ?? null;
}

/**
 * Global, default-deny guard: every route needs a user access token unless it is
 * explicitly marked `@Public()` or `@DeviceAuth()`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const mode =
      this.reflector.getAllAndOverride<AuthMode | undefined>(AUTH_MODE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'user';
    if (mode === 'public') {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const token = bearerToken(request.headers.authorization);
    const principal = token
      ? mode === 'device'
        ? await this.authenticateDevice(token)
        : await this.authenticateUser(token)
      : null;
    if (!principal) {
      throw new UnauthorizedException();
    }
    request.principal = principal;
    return true;
  }

  private async authenticateUser(token: string): Promise<Principal | null> {
    const claims = await this.accessTokens.verify(token);
    if (!claims) {
      return null;
    }
    // Logout and refresh-token reuse revoke the family, which also ends its access tokens.
    const [activeSession] = await this.db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.familyId, claims.sessionFamilyId),
          eq(authSessions.userId, claims.userId),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return activeSession ? { kind: 'user', userId: claims.userId } : null;
  }

  private async authenticateDevice(token: string): Promise<Principal | null> {
    const [device] = await this.db
      .update(devices)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(devices.tokenHash, hashOpaqueToken(token)), isNull(devices.revokedAt)))
      .returning({ id: devices.id, userId: devices.userId });
    return device ? { kind: 'device', userId: device.userId, deviceId: device.id } : null;
  }
}
