export const silentLogger = Object.freeze({
  info() {},
  warn() {},
  error() {},
});

export function serializeError(error) {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const serialized = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  if (error.code) {
    serialized.code = error.code;
  }

  return serialized;
}

export function createLogger({
  output = process.stdout,
  now = () => new Date(),
} = {}) {
  function write(level, event, fields = {}) {
    const {
      timestamp: _timestamp,
      level: _level,
      event: _event,
      ...additionalFields
    } = fields;

    output.write(
      `${JSON.stringify({
        timestamp: now().toISOString(),
        level,
        event,
        ...additionalFields,
      })}\n`,
    );
  }

  return {
    info(event, fields) {
      write('info', event, fields);
    },

    warn(event, fields) {
      write('warn', event, fields);
    },

    error(event, fields) {
      write('error', event, fields);
    },
  };
}
