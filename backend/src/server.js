import { createApp } from './app.js';
import { createTokenService } from './auth/token.service.js';
import { createDatabasePool } from './database.js';

const port = process.env.PORT || 3000;
const tokenService = createTokenService({ secret: process.env.JWT_SECRET });
const database = createDatabasePool();
const app = createApp({ database, tokenService });

const server = app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});

server.once('error', async (error) => {
  console.error('API failed to start', error);
  await database.end();
  process.exitCode = 1;
});

let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`${signal} received, closing API`);

  server.close(async (error) => {
    await database.end();

    if (error) {
      console.error('API shutdown failed', error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
