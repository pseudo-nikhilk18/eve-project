import { Router } from 'express';
import { createAuthenticate } from '../middleware/authenticate.js';
import { createBookingsController } from './bookings.controller.js';

export function createBookingsRouter({ database, tokenService }) {
  const router = Router();
  const controller = createBookingsController({ database });
  const authenticate = createAuthenticate({ tokenService });

  router.get('/', authenticate, controller.list);
  router.get('/:bookingId', authenticate, controller.get);
  router.post('/', authenticate, controller.create);

  return router;
}
