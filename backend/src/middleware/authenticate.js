import { HttpError } from '../errors/http-error.js';

function unauthorizedError() {
  return new HttpError(401, 'UNAUTHORIZED', 'Authentication is required');
}

export function createAuthenticate({ tokenService }) {
  return function authenticate(request, _response, next) {
    const authorization = request.headers.authorization;
    const [scheme, token, extra] = authorization?.split(' ') ?? [];

    if (scheme?.toLowerCase() !== 'bearer' || !token || extra) {
      return next(unauthorizedError());
    }

    try {
      const payload = tokenService.verify(token);

      if (
        typeof payload !== 'object' ||
        typeof payload.sub !== 'string' ||
        !['USER', 'ADMIN'].includes(payload.role)
      ) {
        return next(unauthorizedError());
      }

      request.auth = {
        userId: payload.sub,
        role: payload.role,
      };

      return next();
    } catch {
      return next(unauthorizedError());
    }
  };
}
