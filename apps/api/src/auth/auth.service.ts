import { randomUUID } from 'node:crypto';
import type {
  AuthTokensResponse,
  LoginRequest,
  RegisterRequest,
  UserProfile,
} from '@campuswatch/contracts';
import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { ApiConfig } from '../config.js';
import { API_CONFIG } from '../config.module.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { authSessions, isUniqueViolation, users } from '@campuswatch/db';
import { AccessTokenService } from './access-token.service.js';
import { generateOpaqueToken, hashOpaqueToken } from './opaque-token.js';
import { PasswordHasher } from './password-hasher.js';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly passwords: PasswordHasher,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async register(input: RegisterRequest): Promise<AuthTokensResponse> {
    const passwordHash = await this.passwords.hash(input.password);
    let userId: string;
    try {
      const [user] = await this.db
        .insert(users)
        .values({ email: input.email, passwordHash })
        .returning({ id: users.id });
      userId = user!.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
    return this.startSession(userId, randomUUID());
  }

  async login(input: LoginRequest): Promise<AuthTokensResponse> {
    const [user] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    const valid = user
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords.verifyAgainstDummy(input.password);
    if (!user || !valid || user.status !== 'active') {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.startSession(user.id, randomUUID());
  }

  /**
   * Rotates a refresh token. Each token works once; presenting an already rotated token
   * means it was copied, so the whole session family is revoked.
   */
  async refresh(refreshToken: string): Promise<AuthTokensResponse> {
    const tokenHash = hashOpaqueToken(refreshToken);
    const now = new Date();
    const [consumed] = await this.db
      .update(authSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(authSessions.tokenHash, tokenHash),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, now),
        ),
      )
      .returning({ userId: authSessions.userId, familyId: authSessions.familyId });

    if (!consumed) {
      const [known] = await this.db
        .select({ familyId: authSessions.familyId, revokedAt: authSessions.revokedAt })
        .from(authSessions)
        .where(eq(authSessions.tokenHash, tokenHash))
        .limit(1);
      if (known?.revokedAt) {
        await this.revokeFamily(known.familyId);
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, consumed.userId))
      .limit(1);
    if (user?.status !== 'active') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.startSession(consumed.userId, consumed.familyId);
  }

  /** Ends the session family of the given refresh token. Unknown tokens are ignored. */
  async logout(refreshToken: string): Promise<void> {
    const [session] = await this.db
      .select({ familyId: authSessions.familyId })
      .from(authSessions)
      .where(eq(authSessions.tokenHash, hashOpaqueToken(refreshToken)))
      .limit(1);
    if (session) {
      await this.revokeFamily(session.familyId);
    }
  }

  async profile(userId: string): Promise<UserProfile> {
    const [user] = await this.db
      .select({ id: users.id, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) {
      throw new UnauthorizedException();
    }
    return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() };
  }

  private async startSession(userId: string, familyId: string): Promise<AuthTokensResponse> {
    const refreshToken = generateOpaqueToken('cwr');
    const refreshTokenExpiresAt = new Date(
      Date.now() + this.config.auth.refreshTokenTtlDays * DAY_MS,
    );
    await this.db.insert(authSessions).values({
      userId,
      familyId,
      tokenHash: hashOpaqueToken(refreshToken),
      expiresAt: refreshTokenExpiresAt,
    });
    const access = await this.accessTokens.issue({ userId, sessionFamilyId: familyId });
    return {
      tokenType: 'Bearer',
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.familyId, familyId), isNull(authSessions.revokedAt)));
  }
}
