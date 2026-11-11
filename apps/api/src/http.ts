import type { ApiErrorCode } from '@campuswatch/contracts';
import type { JsonLogger } from '@campuswatch/observability';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

/** Largest accepted request body. A full snapshot of one student is well under 1 MiB. */
export const BODY_LIMIT_BYTES = 2 * 1024 * 1024;

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'bad_request',
  429: 'rate_limited',
  503: 'service_unavailable',
};

export function codeForStatus(status: number): ApiErrorCode {
  return CODE_BY_STATUS[status] ?? (status >= 500 ? 'internal_error' : 'bad_request');
}

/** The HTTP adapter used by the API and by tests, so both enforce the same limits. */
export function createHttpAdapter(options: { trustProxyHops?: number } = {}): FastifyAdapter {
  return new FastifyAdapter({
    bodyLimit: BODY_LIMIT_BYTES,
    // Number of trusted proxy hops, as Fastify's function form (true would trust any client).
    trustProxy: options.trustProxyHops
      ? (_address: string, hop: number) => hop < (options.trustProxyHops ?? 0)
      : false,
    // Fastify's own request logging is replaced by the redacted JSON log below.
    logger: false,
    genReqId: () => crypto.randomUUID(),
  });
}

/**
 * Security headers, request logging (method, route template, status, duration; never headers,
 * bodies, or query strings), and consistent error bodies for errors raised by Fastify itself
 * (malformed JSON, oversized bodies).
 */
export function configureHttp(
  app: NestFastifyApplication,
  options: { logger?: JsonLogger; production: boolean },
): void {
  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook('onSend', (request, reply, payload, done) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('cache-control', 'no-store');
    if (options.production) {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    done(null, payload);
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    options.logger?.event(reply.statusCode >= 500 ? 'error' : 'log', 'http_request', {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url ?? 'unmatched',
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    });
    done();
  });

  fastify.setErrorHandler((error: { statusCode?: number }, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      options.logger?.event('error', 'unhandled_http_error', { requestId: request.id, error });
    }
    void reply.status(status).send({
      statusCode: status,
      code: codeForStatus(status),
      message: status >= 500 ? 'Internal server error' : 'Request could not be processed',
      requestId: request.id,
    });
  });
}
