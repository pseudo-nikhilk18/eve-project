import { HttpError } from '../errors/http-error.js';

export function notFound(_request, _response, next) {
  next(new HttpError(404, 'ROUTE_NOT_FOUND', 'Route not found'));
}
