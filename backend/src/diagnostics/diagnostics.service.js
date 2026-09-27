import { HttpError } from '../errors/http-error.js';

export async function createDiagnosticCentre({ database, name, location }) {
  try {
    const result = await database.query(
      `
        INSERT INTO diagnostic_centres (name, location)
        VALUES ($1, $2)
        RETURNING id, name, location
      `,
      [name, location],
    );

    return {
      ...result.rows[0],
      tests: [],
    };
  } catch (error) {
    if (
      error.code === '23505' &&
      error.constraint === 'diagnostic_centres_name_location_unique'
    ) {
      throw new HttpError(
        409,
        'CENTRE_ALREADY_EXISTS',
        'A diagnostic centre with this name and location already exists',
      );
    }

    throw error;
  }
}

export async function createDiagnosticTest({ database, name }) {
  try {
    const result = await database.query(
      `
        INSERT INTO diagnostic_tests (name)
        VALUES ($1)
        RETURNING id, name
      `,
      [name],
    );

    return result.rows[0];
  } catch (error) {
    if (
      error.code === '23505' &&
      error.constraint === 'diagnostic_tests_name_unique'
    ) {
      throw new HttpError(
        409,
        'DIAGNOSTIC_TEST_ALREADY_EXISTS',
        'A diagnostic test with this name already exists',
      );
    }

    throw error;
  }
}

export async function setCentreTestPrice({
  database,
  centreId,
  testId,
  price,
}) {
  try {
    const result = await database.query(
      `
        INSERT INTO centre_tests (
          centre_id,
          diagnostic_test_id,
          price_paise
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (centre_id, diagnostic_test_id)
        DO UPDATE SET
          price_paise = EXCLUDED.price_paise,
          is_available = true,
          updated_at = now()
        RETURNING
          centre_id AS "centreId",
          diagnostic_test_id AS "testId",
          price_paise AS "priceInPaise",
          is_available AS "isAvailable"
      `,
      [centreId, testId, Math.round(price * 100)],
    );

    const offering = result.rows[0];

    return {
      centreId: offering.centreId,
      testId: offering.testId,
      price: offering.priceInPaise / 100,
      isAvailable: offering.isAvailable,
    };
  } catch (error) {
    if (
      error.code === '23503' &&
      error.constraint === 'centre_tests_centre_id_fkey'
    ) {
      throw new HttpError(
        404,
        'DIAGNOSTIC_CENTRE_NOT_FOUND',
        'Diagnostic centre not found',
      );
    }

    if (
      error.code === '23503' &&
      error.constraint === 'centre_tests_diagnostic_test_id_fkey'
    ) {
      throw new HttpError(
        404,
        'DIAGNOSTIC_TEST_NOT_FOUND',
        'Diagnostic test not found',
      );
    }

    throw error;
  }
}

export async function listDiagnosticCentres({ database }) {
  const result = await database.query(`
    SELECT
      centre.id AS "centreId",
      centre.name AS "centreName",
      centre.location,
      diagnostic_test.id AS "testId",
      diagnostic_test.name AS "testName",
      offering.price_paise AS "priceInPaise"
    FROM diagnostic_centres AS centre
    LEFT JOIN centre_tests AS offering
      ON offering.centre_id = centre.id
      AND offering.is_available = true
    LEFT JOIN diagnostic_tests AS diagnostic_test
      ON diagnostic_test.id = offering.diagnostic_test_id
      AND diagnostic_test.is_active = true
    WHERE centre.is_active = true
    ORDER BY
      lower(centre.name),
      centre.id,
      lower(diagnostic_test.name),
      diagnostic_test.id
  `);

  const centresById = new Map();

  for (const row of result.rows) {
    let centre = centresById.get(row.centreId);

    if (!centre) {
      centre = {
        id: row.centreId,
        name: row.centreName,
        location: row.location,
        tests: [],
      };
      centresById.set(row.centreId, centre);
    }

    if (row.testId) {
      centre.tests.push({
        id: row.testId,
        name: row.testName,
        price: row.priceInPaise / 100,
      });
    }
  }

  return [...centresById.values()];
}
