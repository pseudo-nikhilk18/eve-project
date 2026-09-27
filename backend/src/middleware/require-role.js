import { HttpError } from '../errors/http-error.js';

export function requireRole(role) {
  return function authorizeRole(request, _response, next) {
    if (request.auth?.role !== role) {
      return next(
        new HttpError(
          403,
          'FORBIDDEN',
          'You do not have permission to perform this action',
        ),
      );
    }

    return next();
  };
}
