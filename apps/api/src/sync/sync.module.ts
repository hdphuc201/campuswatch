import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
