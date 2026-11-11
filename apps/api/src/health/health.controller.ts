import type { HealthResponse } from '@campuswatch/contracts';
import { Controller, Get } from '@nestjs/common';

export const API_SERVICE_NAME = 'campuswatch-api';

/** Liveness probe. Dependency checks (database, Redis) arrive with those modules. */
@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: API_SERVICE_NAME,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
