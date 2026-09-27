export function databaseText(schema) {
  return schema.refine(
    (value) => !value.includes('\u0000'),
    'Must not contain null characters',
  );
}
