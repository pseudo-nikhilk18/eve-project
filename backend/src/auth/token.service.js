import jsonwebtoken from 'jsonwebtoken';

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

export function createTokenService({ secret }) {
  if (!secret || !secret.trim()) {
    throw new Error('JWT_SECRET is required to start the API');
  }

  return {
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,

    sign({ userId, role }) {
      return jsonwebtoken.sign({ role }, secret, {
        algorithm: 'HS256',
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        subject: userId,
      });
    },

    verify(token) {
      return jsonwebtoken.verify(token, secret, {
        algorithms: ['HS256'],
      });
    },
  };
}
