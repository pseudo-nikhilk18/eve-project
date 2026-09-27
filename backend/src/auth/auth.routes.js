import { Router } from 'express';
import { createAuthController } from './auth.controller.js';

export function createAuthRouter({ database, tokenService }) {
  const router = Router();
  const controller = createAuthController({ database, tokenService });

  router.post('/signup', controller.signup);
  router.post('/login', controller.login);

  return router;
}
