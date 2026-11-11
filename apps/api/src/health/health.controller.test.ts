import { healthResponseSchema, readinessResponseSchema } from '@campuswatch/contracts';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PG_POOL } from '../database/database.module.js';
import { API_SERVICE_NAME, HealthController } from './health.controller.js';

describe('HealthController', () => {
  const query = vi.fn<() => Promise<unknown>>();
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PG_POOL, useValue: { query } }],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health matches the shared health contract', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    const body = healthResponseSchema.parse(response.json());
    expect(body.service).toBe(API_SERVICE_NAME);
  });

  it('GET /health/ready reports ok when the database answers', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(readinessResponseSchema.parse(response.json()).checks.database).toBe('ok');
  });

  it('GET /health/ready returns 503 without leaking the database error', async () => {
    query.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:5432'));

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable', checks: { database: 'error' } });
    expect(response.body).not.toContain('ECONNREFUSED');
  });

  it('returns 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);
  });
});
