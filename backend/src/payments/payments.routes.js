import { Router } from 'express';
import { createAuthenticate } from '../middleware/authenticate.js';
import { createPaymentsController } from './payments.controller.js';

export function createPaymentsRouter({ database, tokenService }) {
  const router = Router();
  const controller = createPaymentsController({ database });
  const authenticate = createAuthenticate({ tokenService });

  router.post('/webhook', controller.webhook);
  router.post('/', authenticate, controller.create);

  return router;
}
