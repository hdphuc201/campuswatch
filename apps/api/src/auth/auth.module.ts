import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordHasher } from './password-hasher.js';

@Module({
  controllers: [AuthController],
  providers: [
    AccessTokenService,
    AuthService,
    PasswordHasher,
    // Registered globally: every route in the app is protected by default.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
