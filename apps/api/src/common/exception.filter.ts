import type { ApiErrorBody, ApiErrorCode } from '@campuswatch/contracts';
import { apiErrorCodeSchema } from '@campuswatch/contracts';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { codeForStatus } from '../http.js';

interface Reply {
  status(code: number): Reply;
  send(body: unknown): void;
}

/**
 * Every error response has `{ statusCode, code, message, requestId }`. Unexpected errors become
 * a generic 500: their message (which might contain data) is logged redacted, never returned.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ id?: string }>();
    const reply = http.getResponse<Reply>();

    let body: ApiErrorBody;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const details = typeof response === 'object' && response !== null ? response : {};
      const { code, message, issues } = details as {
        code?: unknown;
        message?: unknown;
        issues?: ApiErrorBody['issues'];
      };
      const parsedCode = apiErrorCodeSchema.safeParse(code);
      const fallback: ApiErrorCode =
        status === 400 && issues ? 'validation_failed' : codeForStatus(status);
      body = {
        statusCode: status,
        code: parsedCode.success ? parsedCode.data : fallback,
        message:
          typeof message === 'string'
            ? message
            : typeof response === 'string'
              ? response
              : exception.message,
        ...(issues ? { issues } : {}),
        ...(request.id ? { requestId: request.id } : {}),
      };
    } else {
      this.logger.error(exception instanceof Error ? exception : 'Non-error thrown');
      body = {
        statusCode: 500,
        code: 'internal_error',
        message: 'Internal server error',
        ...(request.id ? { requestId: request.id } : {}),
      };
    }
    reply.status(body.statusCode).send(body);
  }
}
