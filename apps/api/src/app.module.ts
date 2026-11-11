import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './common/exception.filter.js';
import { AuthModule } from './auth/auth.module.js';
import type { ApiConfig } from './config.js';
import { ApiConfigModule } from './config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { HealthController } from './health/health.controller.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PortalConnectionsModule } from './portal-connections/portal-connections.module.js';
import { PrivacyModule } from './privacy/privacy.module.js';
import { SyncModule } from './sync/sync.module.js';

@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ApiConfigModule.register(config),
        DatabaseModule.register(config.database),
        AuthModule,
        DevicesModule,
        PortalConnectionsModule,
        SyncModule,
        NotificationsModule,
        PrivacyModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
    };
  }
}
