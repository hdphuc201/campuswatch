import type { HealthResponse, ReadinessResponse } from '@campuswatch/contracts';
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type pg from 'pg';
import { Public } from '../auth/principal.js';
import { PG_POOL } from '../database/database.module.js';

export const API_SERVICE_NAME = 'campuswatch-api';

@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: API_SERVICE_NAME,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  /** Readiness: the database answers. Returns 503 otherwise. */
  @Get('ready')
  async getReadiness(): Promise<ReadinessResponse> {
    try {
      await this.pool.query('select 1');
      return { status: 'ok', checks: { database: 'ok' } };
    } catch {
      const body: ReadinessResponse = { status: 'unavailable', checks: { database: 'error' } };
      throw new ServiceUnavailableException(body);
    }
  }
}
