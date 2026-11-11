import { secretsEqual } from '@campuswatch/notifications/server';
import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/principal.js';
import type { ApiConfig } from '../config.js';
import { API_CONFIG } from '../config.module.js';
import { DATABASE, type Database } from '../database/database.module.js';

interface Row {
  [key: string]: unknown;
}

const label = (value: unknown) => String(value).replace(/[^\w.-]/g, '_');

/**
 * Aggregate operational metrics in Prometheus text format (plan section 8, "Admin
 * operations"): counts by status, source, error code, and channel only. No user ids, no
 * academic data. Disabled (404) unless OPS_METRICS_TOKEN is set; requires that bearer token.
 */
@Public()
@Controller('ops')
export class OpsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Get('metrics')
  async metrics(
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) reply: { header(name: string, value: string): void },
  ): Promise<string> {
    const token = this.config.opsMetricsToken;
    if (!token) {
      throw new NotFoundException();
    }
    if (!secretsEqual(authorization?.replace(/^Bearer /, ''), token)) {
      throw new UnauthorizedException();
    }

    // Set only on success, so error responses keep their JSON body.
    reply.header('content-type', 'text/plain; version=0.0.4');
    const query = async (statement: ReturnType<typeof sql>) =>
      (await this.db.execute(statement)).rows as Row[];
    const [runs, sourceErrors, connections, deliveries, oldestPending] = await Promise.all([
      query(sql`select status, count(*)::int as n from sync_runs
                where received_at > now() - interval '24 hours' group by status`),
      query(sql`select r->>'source' as source, r->>'errorCode' as code, count(*)::int as n
                from sync_runs, jsonb_array_elements(source_results) r
                where received_at > now() - interval '24 hours' and r->>'status' = 'error'
                group by 1, 2`),
      query(sql`select status, count(*)::int as n from portal_connections group by status`),
      query(sql`select channel, status, count(*)::int as n from notification_deliveries
                where status in ('pending', 'sending', 'failed') group by 1, 2`),
      query(sql`select channel, coalesce(extract(epoch from now() - min(deliver_after)), 0)::int as s
                from notification_deliveries
                where status = 'pending' and deliver_after <= now() group by channel`),
    ]);

    const lines = [
      '# HELP campuswatch_sync_runs_24h Sync runs received in the last 24 hours.',
      '# TYPE campuswatch_sync_runs_24h gauge',
      ...runs.map((r) => `campuswatch_sync_runs_24h{status="${label(r.status)}"} ${Number(r.n)}`),
      '# HELP campuswatch_source_errors_24h Failed sources in the last 24 hours (ADAPTER_NEEDS_UPDATE = selector drift).',
      '# TYPE campuswatch_source_errors_24h gauge',
      ...sourceErrors.map(
        (r) =>
          `campuswatch_source_errors_24h{source="${label(r.source)}",code="${label(r.code)}"} ${Number(r.n)}`,
      ),
      '# HELP campuswatch_connections Portal connections by health state.',
      '# TYPE campuswatch_connections gauge',
      ...connections.map(
        (r) => `campuswatch_connections{status="${label(r.status)}"} ${Number(r.n)}`,
      ),
      '# HELP campuswatch_deliveries Notification deliveries not yet sent, by channel and status.',
      '# TYPE campuswatch_deliveries gauge',
      ...deliveries.map(
        (r) =>
          `campuswatch_deliveries{channel="${label(r.channel)}",status="${label(r.status)}"} ${Number(r.n)}`,
      ),
      '# HELP campuswatch_oldest_due_delivery_seconds Age of the oldest due, unsent delivery.',
      '# TYPE campuswatch_oldest_due_delivery_seconds gauge',
      ...oldestPending.map(
        (r) =>
          `campuswatch_oldest_due_delivery_seconds{channel="${label(r.channel)}"} ${Number(r.s)}`,
      ),
    ];
    return `${lines.join('\n')}\n`;
  }
}
