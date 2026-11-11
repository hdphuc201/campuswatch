import {
  type ChangeListQuery,
  changeListQuerySchema,
  type ChangeListResponse,
  type EntityListQuery,
  entityListQuerySchema,
  type EntityListResponse,
  type EntityType,
  entityTypeSchema,
  type SnapshotRequest,
  snapshotRequestSchema,
  type SyncRunResult,
} from '@campuswatch/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  CurrentDevice,
  CurrentUserId,
  DeviceAuth,
  type DevicePrincipal,
} from '../auth/principal.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SyncService } from './sync.service.js';

@Controller()
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /** Snapshot upload from the extension (device token). Idempotent per `syncRunId`. */
  @DeviceAuth()
  @Post('sync-runs')
  @HttpCode(200)
  ingest(
    @CurrentDevice() device: DevicePrincipal,
    @Body(new ZodValidationPipe(snapshotRequestSchema)) body: SnapshotRequest,
  ): Promise<SyncRunResult> {
    return this.sync.ingest(device, body);
  }

  @Get('changes')
  changes(
    @CurrentUserId() userId: string,
    @Query(new ZodValidationPipe(changeListQuerySchema)) query: ChangeListQuery,
  ): Promise<ChangeListResponse> {
    return this.sync.listChanges(userId, query);
  }

  @Get('entities/:type')
  entities(
    @CurrentUserId() userId: string,
    @Param('type', new ZodValidationPipe(entityTypeSchema)) entityType: EntityType,
    @Query(new ZodValidationPipe(entityListQuerySchema)) query: EntityListQuery,
  ): Promise<EntityListResponse> {
    return this.sync.listEntities(userId, entityType, query.connectionId);
  }
}
