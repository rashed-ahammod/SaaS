/**
 * Turns every error into one response shape, in the user's language:
 *
 *   { "statusCode": 404, "code": "USER_NOT_FOUND", "message": "User not found." }
 *
 * - `code` is stable for the frontend to react to; `message` is for people.
 * - Unexpected errors are logged in full but return only INTERNAL_ERROR, so
 *   stack traces and SQL never reach the client.
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  isMessageKey,
  languageFromHeader,
  languageOverride,
  MSG,
  translate,
} from '../i18n/messages.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const lang =
      req.auth?.language ??
      languageOverride(req.headers['x-language']) ??
      languageFromHeader(req.headers['accept-language']);

    // Database constraint errors are the last line of defence; turn them into clear answers.
    const dbError = mapDatabaseError(exception);
    if (dbError) {
      res.status(dbError.status).json({
        statusCode: dbError.status,
        code: dbError.code,
        message: translate(dbError.code, lang),
      });
      return;
    }

    // client errors raised by Express middleware (body too large, malformed JSON): their status, no internals
    const clientError = expressClientError(exception);
    if (clientError) {
      res.status(clientError).json({
        statusCode: clientError,
        code: MSG.VALIDATION_FAILED,
        message: translate(MSG.VALIDATION_FAILED, lang),
      });
      return;
    }

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `${req.method} ${req.url} failed`,
        exception instanceof Error ? exception.stack : exception,
      );
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: MSG.INTERNAL_ERROR,
        message: translate(MSG.INTERNAL_ERROR, lang),
      });
      return;
    }

    const status = exception.getStatus();
    const body = exception.getResponse();
    const raw =
      typeof body === 'string' ? body : (body as { message?: unknown }).message;

    // ValidationPipe returns a list of field errors: keep them as `details`.
    if (Array.isArray(raw)) {
      res.status(status).json({
        statusCode: status,
        code: MSG.VALIDATION_FAILED,
        message: translate(MSG.VALIDATION_FAILED, lang),
        details: raw,
      });
      return;
    }

    const text = typeof raw === 'string' ? raw : exception.message;
    // services may add machine-readable details: throw new XException({ message: MSG.X, details: {...} })
    const details =
      typeof body === 'object' && body !== null && 'details' in body
        ? (body as { details: unknown }).details
        : undefined;
    res.status(status).json({
      statusCode: status,
      code: isMessageKey(text) ? text : codeForStatus(status),
      message: translate(text, lang),
      ...(details !== undefined ? { details } : {}),
    });
  }
}

/**
 * PostgreSQL error codes:
 *   23505 unique violation      -> 409 DUPLICATE_VALUE      (e.g. same department code twice)
 *   23P01 exclusion violation   -> 409 STALE_VERSION        (overlapping periods: concurrent edit)
 *   23503 foreign key violation -> 400 REFERENCE_NOT_FOUND  (id of another company / tenant)
 */
function mapDatabaseError(
  err: unknown,
): { status: number; code: string } | undefined {
  const code = (err as { code?: unknown })?.code;
  if (typeof code !== 'string' || !(err instanceof Error)) return undefined;
  if (code === '23505') return { status: 409, code: MSG.DUPLICATE_VALUE };
  if (code === '23P01') return { status: 409, code: MSG.STALE_VERSION };
  if (code === '23503') return { status: 400, code: MSG.REFERENCE_NOT_FOUND };
  return undefined;
}

function codeForStatus(status: number): string {
  if (status === 401) return MSG.AUTH_REQUIRED;
  if (status === 403) return MSG.FORBIDDEN;
  if (status === 404) return MSG.NOT_FOUND;
  return HttpStatus[status] ?? 'ERROR';
}

/** body-parser / http-errors style errors that are the client's fault (4xx, safe to expose). */
function expressClientError(exception: unknown): number | null {
  if (
    exception instanceof HttpException ||
    !exception ||
    typeof exception !== 'object'
  )
    return null;
  const e = exception as { status?: unknown; expose?: unknown };
  return typeof e.status === 'number' &&
    e.status >= 400 &&
    e.status < 500 &&
    e.expose === true
    ? e.status
    : null;
}
