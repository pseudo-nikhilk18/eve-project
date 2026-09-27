import { z } from 'zod';
import { databaseText } from '../validation.js';

const MAX_PRICE_INR = 21_474_836.47;

export const createCentreSchema = z
  .object({
    name: databaseText(z.string().trim().min(1).max(160)),
    location: databaseText(z.string().trim().min(1)),
  })
  .strict();

export const createDiagnosticTestSchema = z
  .object({
    name: databaseText(z.string().trim().min(1).max(160)),
  })
  .strict();

export const setCentreTestParamsSchema = z.object({
  centreId: z.uuid(),
  testId: z.uuid(),
});

export const setCentreTestSchema = z
  .object({
    price: z.number().positive().max(MAX_PRICE_INR).multipleOf(0.01),
  })
  .strict();
