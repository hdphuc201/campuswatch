import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordHasher } from './password-hasher.js';
import type { ApiConfig } from '../config.js';
import { API_CONFIG } from '../config.module.js';
import { createRateLimitStore, RATE_LIMIT_STORE, RateLimitGuard } from '../security/rate-limit.js';

@Module({
  controllers: [AuthController],
  providers: [
    AccessTokenService,
    AuthService,
    PasswordHasher,
    // Registered globally, in this order: authenticate (default deny), then rate-limit.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    {
      provide: RATE_LIMIT_STORE,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => createRateLimitStore(config),
    },
  ],
  exports: [PasswordHasher],
})
export class AuthModule {}
