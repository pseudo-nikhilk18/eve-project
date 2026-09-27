import { loginSchema, signupSchema } from './auth.schema.js';
import { authenticateUser, signupUser } from './auth.service.js';

export function createAuthController({ database, tokenService }) {
  return {
    async signup(request, response) {
      const input = signupSchema.parse(request.body);
      const user = await signupUser({ database, ...input });

      response.status(201).json({ data: { user } });
    },

    async login(request, response) {
      const input = loginSchema.parse(request.body);
      const user = await authenticateUser({ database, ...input });
      const accessToken = tokenService.sign({
        userId: user.id,
        role: user.role,
      });

      response.json({
        data: {
          user,
          accessToken,
          tokenType: 'Bearer',
          expiresIn: tokenService.expiresInSeconds,
        },
      });
    },
  };
}
