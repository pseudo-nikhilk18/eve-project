FROM node:22-bookworm-slim AS base

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./

FROM base AS test

ENV NODE_ENV=test

RUN npm ci && npm cache clean --force

COPY --chown=node:node db ./db
COPY --chown=node:node src ./src
COPY --chown=node:node integration ./integration

USER node

CMD ["npm", "run", "test:integration"]

FROM base AS production

ENV NODE_ENV=production

RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node db ./db
COPY --chown=node:node src ./src

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
