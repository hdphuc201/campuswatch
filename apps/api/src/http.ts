import { FastifyAdapter } from '@nestjs/platform-fastify';

/** Largest accepted request body. A full snapshot of one student is well under 1 MiB. */
export const BODY_LIMIT_BYTES = 2 * 1024 * 1024;

/** The HTTP adapter used by the API and by tests, so both enforce the same limits. */
export function createHttpAdapter(): FastifyAdapter {
  return new FastifyAdapter({ bodyLimit: BODY_LIMIT_BYTES });
}
