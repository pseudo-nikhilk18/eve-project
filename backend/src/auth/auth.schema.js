import { z } from 'zod';
import { databaseText } from '../validation.js';

export const signupSchema = z
  .object({
    fullName: databaseText(z.string().trim().min(2).max(120)),
    email: databaseText(
      z.string().trim().toLowerCase().email().max(254),
    ),
    password: z.string().min(8).max(128),
  })
  .strict();

export const loginSchema = z
  .object({
    email: databaseText(
      z.string().trim().toLowerCase().email().max(254),
    ),
    password: z.string().min(1).max(128),
  })
  .strict();
