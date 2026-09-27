import { Router } from 'express';
import { createAuthenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/require-role.js';
import { createDiagnosticsController } from './diagnostics.controller.js';

export function createDiagnosticsRouter({ database, tokenService }) {
  const router = Router();
  const controller = createDiagnosticsController({ database });
  const authenticate = createAuthenticate({ tokenService });

  router.get('/diagnostic-centres', controller.listCentres);
  router.post(
    '/diagnostic-centres',
    authenticate,
    requireRole('ADMIN'),
    controller.createCentre,
  );
  router.post(
    '/diagnostic-tests',
    authenticate,
    requireRole('ADMIN'),
    controller.createTest,
  );
  router.put(
    '/diagnostic-centres/:centreId/tests/:testId',
    authenticate,
    requireRole('ADMIN'),
    controller.setCentreTest,
  );

  return router;
}
