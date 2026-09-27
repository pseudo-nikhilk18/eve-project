FROM node:22-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node db ./db
COPY --chown=node:node src ./src

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
