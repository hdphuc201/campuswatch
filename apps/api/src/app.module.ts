import { type DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import type { ApiConfig } from './config.js';
import { ApiConfigModule } from './config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { HealthController } from './health/health.controller.js';
import { PortalConnectionsModule } from './portal-connections/portal-connections.module.js';

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
      ],
      controllers: [HealthController],
    };
  }
}
