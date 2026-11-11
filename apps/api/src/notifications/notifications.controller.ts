import {
  type AckNotificationsRequest,
  ackNotificationsRequestSchema,
  type DeliveryListResponse,
  type NotificationPreferences,
  notificationPreferencesSchema,
  type PendingNotificationsResponse,
  type TelegramLinkStartResponse,
  type TelegramLinkStatus,
} from '@campuswatch/contracts';
import { Body, Controller, Delete, Get, Headers, HttpCode, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  CurrentDevice,
  CurrentUserId,
  DeviceAuth,
  type DevicePrincipal,
  Public,
} from '../auth/principal.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RateLimit } from '../security/rate-limit.js';
import { NotificationsService } from './notifications.service.js';
import { TelegramService } from './telegram.service.js';

export const deliveryListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type DeliveryListQuery = z.infer<typeof deliveryListQuerySchema>;

@Controller()
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramService,
  ) {}

  @Get('notification-preferences')
  getPreferences(@CurrentUserId() userId: string): Promise<NotificationPreferences> {
    return this.notifications.getPreferences(userId);
  }

  @Put('notification-preferences')
  updatePreferences(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(notificationPreferencesSchema)) body: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    return this.notifications.updatePreferences(userId, body);
  }

  /** Delivery status for the user, newest first. */
  @Get('notifications')
  async list(
    @CurrentUserId() userId: string,
    @Query(new ZodValidationPipe(deliveryListQuerySchema)) query: DeliveryListQuery,
  ): Promise<DeliveryListResponse> {
    return { deliveries: await this.notifications.listDeliveries(userId, query.limit) };
  }

  @DeviceAuth()
  @RateLimit('pendingNotifications')
  @Get('notifications/pending')
  pending(@CurrentDevice() device: DevicePrincipal): Promise<PendingNotificationsResponse> {
    return this.notifications.claimChrome(device);
  }

  @DeviceAuth()
  @Post('notifications/ack')
  @HttpCode(204)
  ack(
    @CurrentDevice() device: DevicePrincipal,
    @Body(new ZodValidationPipe(ackNotificationsRequestSchema)) body: AckNotificationsRequest,
  ): Promise<void> {
    return this.notifications.ackChrome(device, body.deliveryIds);
  }

  @Get('telegram/link')
  telegramStatus(@CurrentUserId() userId: string): Promise<TelegramLinkStatus> {
    return this.telegram.status(userId);
  }

  @RateLimit('telegramStart')
  @Post('telegram/link/start')
  @HttpCode(200)
  telegramStart(@CurrentUserId() userId: string): Promise<TelegramLinkStartResponse> {
    return this.telegram.startLink(userId);
  }

  @Delete('telegram/link')
  @HttpCode(204)
  telegramUnlink(@CurrentUserId() userId: string): Promise<void> {
    return this.telegram.unlink(userId);
  }

  /** Telegram Bot API webhook. Authenticated by the secret token header, not by a user. */
  @Public()
  @RateLimit('telegramWebhook')
  @Post('telegram/webhook')
  @HttpCode(200)
  telegramWebhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() body: unknown,
  ): Promise<void> {
    return this.telegram.handleWebhook(secret, body);
  }
}
