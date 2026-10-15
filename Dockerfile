# syntax=docker/dockerfile:1
# VANTYX® — imagem de produção (Node 22, SQLite persistente em /data)
#
# Build:  docker build -t vantyx .
# Run:    docker run -d -p 3000:3000 -v vantyx-data:/data --name vantyx vantyx
# Demo:   docker exec -it vantyx npm run seed:demo

# ---------- estágio 1: dependências + build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 compila a partir do código (node-gyp) — ferramentas necessárias
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- estágio 2: runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# BD operacional fora da imagem — montar volume em /data
ENV VANTYX_DB_PATH=/data/vantyx.db

RUN mkdir -p /data && chown -R node:node /data
USER node

# node_modules completo (inclui better-sqlite3 compilado no mesmo OS/ABI
# e tsx para os scripts de migração/seed correrem dentro do contentor)
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/app ./app
COPY --from=build --chown=node:node /app/components ./components
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=node:node /app/vitest.config.ts ./vitest.config.ts
COPY --from=build --chown=node:node /app/tests ./tests

EXPOSE 3000
VOLUME /data

# As migrações são aplicadas automaticamente no primeiro acesso à BD (getDb).
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
