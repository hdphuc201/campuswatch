import {
  type ConsentListResponse,
  type DataExport,
  type DeletionResult,
  type ReauthenticationRequest,
  reauthenticationRequestSchema,
} from '@campuswatch/contracts';
import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentUserId } from '../auth/principal.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RateLimit } from '../security/rate-limit.js';
import { PrivacyService } from './privacy.service.js';

@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('consents')
  consents(@CurrentUserId() userId: string): Promise<ConsentListResponse> {
    return this.privacy.consents(userId);
  }

  @RateLimit('privacy')
  @Post('export')
  @HttpCode(200)
  async export(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(reauthenticationRequestSchema)) body: ReauthenticationRequest,
  ): Promise<DataExport> {
    await this.privacy.reauthenticate(userId, body.password);
    return this.privacy.export(userId);
  }

  @RateLimit('privacy')
  @Delete('data')
  @HttpCode(200)
  async deleteData(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(reauthenticationRequestSchema)) body: ReauthenticationRequest,
  ): Promise<DeletionResult> {
    await this.privacy.reauthenticate(userId, body.password);
    return this.privacy.deleteData(userId);
  }

  @RateLimit('privacy')
  @Delete('account')
  @HttpCode(200)
  async deleteAccount(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(reauthenticationRequestSchema)) body: ReauthenticationRequest,
  ): Promise<DeletionResult> {
    await this.privacy.reauthenticate(userId, body.password);
    return this.privacy.deleteAccount(userId);
  }
}
