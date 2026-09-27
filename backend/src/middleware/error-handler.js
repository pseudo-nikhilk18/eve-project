import { ZodError } from 'zod';
import { HttpError } from '../errors/http-error.js';
import { serializeError } from '../logger.js';

export function createErrorHandler({ logger }) {
  return function errorHandler(error, request, response, _next) {
    if (error.type === 'entity.parse.failed') {
      return response.status(400).json({
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must contain valid JSON',
        },
      });
    }

    if (error instanceof ZodError) {
      return response.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }

    if (error instanceof HttpError) {
      return response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    logger.error('http.request.failed', {
      requestId: request.requestId,
      error: serializeError(error),
    });

    return response.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'The request could not be completed',
      },
    });
  };
}
