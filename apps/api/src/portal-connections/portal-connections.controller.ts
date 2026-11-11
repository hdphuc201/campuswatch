import {
  type CreatePortalConnectionRequest,
  createPortalConnectionRequestSchema,
  type PortalConnection,
  type PortalConnectionListResponse,
  type ProbeReportRequest,
  probeReportRequestSchema,
} from '@campuswatch/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  CurrentDevice,
  CurrentUserId,
  DeviceAuth,
  type DevicePrincipal,
} from '../auth/principal.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PortalConnectionsService } from './portal-connections.service.js';

@Controller('portal-connections')
export class PortalConnectionsController {
  constructor(private readonly connections: PortalConnectionsService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createPortalConnectionRequestSchema))
    body: CreatePortalConnectionRequest,
  ): Promise<PortalConnection> {
    return this.connections.create(userId, body);
  }

  @Get()
  async list(@CurrentUserId() userId: string): Promise<PortalConnectionListResponse> {
    return { connections: await this.connections.list(userId) };
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUserId() userId: string,
    @Param('id', new ParseUUIDPipe()) connectionId: string,
  ): Promise<void> {
    return this.connections.remove(userId, connectionId);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(
    @CurrentUserId() userId: string,
    @Param('id', new ParseUUIDPipe()) connectionId: string,
  ): Promise<PortalConnection> {
    return this.connections.pause(userId, connectionId);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(
    @CurrentUserId() userId: string,
    @Param('id', new ParseUUIDPipe()) connectionId: string,
  ): Promise<PortalConnection> {
    return this.connections.resume(userId, connectionId);
  }

  /** Called by the extension with its device token; the device's owner must own the connection. */
  @DeviceAuth()
  @Post(':id/probe')
  @HttpCode(200)
  probe(
    @CurrentDevice() device: DevicePrincipal,
    @Param('id', new ParseUUIDPipe()) connectionId: string,
    @Body(new ZodValidationPipe(probeReportRequestSchema)) body: ProbeReportRequest,
  ): Promise<PortalConnection> {
    return this.connections.reportProbe(device.userId, connectionId, body);
  }
}
