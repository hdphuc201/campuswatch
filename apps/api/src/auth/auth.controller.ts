import {
  type AuthTokensResponse,
  type RegisterAcceptedResponse,
  type LoginRequest,
  loginRequestSchema,
  type RefreshTokenRequest,
  refreshTokenRequestSchema,
  type RegisterRequest,
  registerRequestSchema,
  type UserProfile,
} from '@campuswatch/contracts';
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RateLimit } from '../security/rate-limit.js';
import { AuthService } from './auth.service.js';
import { CurrentUserId, Public } from './principal.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Always 202 with the same body, whether the email is new or already registered, so the
   * endpoint cannot be used to discover accounts. The client signs in afterwards.
   */
  @Public()
  @RateLimit('register')
  @Post('register')
  @HttpCode(202)
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
  ): Promise<RegisterAcceptedResponse> {
    await this.auth.register(body);
    return { status: 'accepted' };
  }

  @Public()
  @RateLimit('login')
  @Post('login')
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
  ): Promise<AuthTokensResponse> {
    return this.auth.login(body);
  }

  @Public()
  @RateLimit('refresh')
  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body(new ZodValidationPipe(refreshTokenRequestSchema)) body: RefreshTokenRequest,
  ): Promise<AuthTokensResponse> {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(
    @Body(new ZodValidationPipe(refreshTokenRequestSchema)) body: RefreshTokenRequest,
  ): Promise<void> {
    return this.auth.logout(body.refreshToken);
  }

  @Get('me')
  me(@CurrentUserId() userId: string): Promise<UserProfile> {
    return this.auth.profile(userId);
  }
}
