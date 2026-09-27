import argon2 from 'argon2';
import { HttpError } from '../errors/http-error.js';

export async function signupUser({ database, fullName, email, password }) {
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
  });

  try {
    const result = await database.query(
      `
        INSERT INTO users (full_name, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING
          id,
          full_name AS "fullName",
          email,
          role,
          created_at AS "createdAt"
      `,
      [fullName, email, passwordHash],
    );

    return result.rows[0];
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'users_email_key') {
      throw new HttpError(
        409,
        'EMAIL_ALREADY_REGISTERED',
        'An account with this email already exists',
      );
    }

    throw error;
  }
}

export async function authenticateUser({ database, email, password }) {
  const result = await database.query(
    `
      SELECT
        id,
        full_name AS "fullName",
        email,
        password_hash AS "passwordHash",
        role,
        created_at AS "createdAt"
      FROM users
      WHERE email = $1
    `,
    [email],
  );

  const user = result.rows[0];

  if (!user || !(await argon2.verify(user.passwordHash, password))) {
    throw new HttpError(
      401,
      'INVALID_CREDENTIALS',
      'Email or password is incorrect',
    );
  }

  const { passwordHash: _passwordHash, ...authenticatedUser } = user;

  return authenticatedUser;
}
