import { createChatIdCipher, createHttpTelegramClient } from '@campuswatch/notifications/server';
import { Module } from '@nestjs/common';
import type { ApiConfig } from '../config.js';
import { API_CONFIG } from '../config.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { CHAT_ID_CIPHER, TELEGRAM_CLIENT, TelegramService } from './telegram.service.js';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    TelegramService,
    {
      provide: TELEGRAM_CLIENT,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) =>
        config.telegram ? createHttpTelegramClient(config.telegram.botToken) : null,
    },
    {
      provide: CHAT_ID_CIPHER,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) =>
        config.telegram ? createChatIdCipher(config.telegram.encryptionKey) : null,
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
