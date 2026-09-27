import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

function getRequestId(request) {
  const suppliedRequestId = request.get('x-request-id');

  if (suppliedRequestId && REQUEST_ID_PATTERN.test(suppliedRequestId)) {
    return suppliedRequestId;
  }

  return randomUUID();
}

export function createRequestLogger({ logger }) {
  return function requestLogger(request, response, next) {
    const requestId = getRequestId(request);
    const startedAt = process.hrtime.bigint();
    const path = request.path;

    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    response.once('finish', () => {
      const durationNanoseconds = process.hrtime.bigint() - startedAt;

      logger.info('http.request.completed', {
        requestId,
        method: request.method,
        path,
        statusCode: response.statusCode,
        durationMs: Number(durationNanoseconds) / 1_000_000,
      });
    });

    next();
  };
}
