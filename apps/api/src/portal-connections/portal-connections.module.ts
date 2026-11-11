import { Module } from '@nestjs/common';
import { PortalConnectionsController } from './portal-connections.controller.js';
import { PortalConnectionsService } from './portal-connections.service.js';

@Module({
  controllers: [PortalConnectionsController],
  providers: [PortalConnectionsService],
})
export class PortalConnectionsModule {}
