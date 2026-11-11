import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OpsController } from '../ops/ops.controller.js';
import { PrivacyController } from './privacy.controller.js';
import { PrivacyService } from './privacy.service.js';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [PrivacyController, OpsController],
  providers: [PrivacyService],
})
export class PrivacyModule {}
