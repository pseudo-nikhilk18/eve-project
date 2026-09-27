import { z } from 'zod';

export const createCentreSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    location: z.string().trim().min(1),
  })
  .strict();

export const createDiagnosticTestSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
  })
  .strict();

export const setCentreTestParamsSchema = z.object({
  centreId: z.uuid(),
  testId: z.uuid(),
});

export const setCentreTestSchema = z
  .object({
    price: z.number().positive().multipleOf(0.01),
  })
  .strict();
