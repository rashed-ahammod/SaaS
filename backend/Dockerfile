# syntax=docker/dockerfile:1
#
# ERP API and worker. One image serves both: the API is `node dist/main.js`,
# the worker `node dist/worker.js` (see infra/docker-compose.prod.yml).
#
# Built for linux/amd64 and linux/arm64. argon2 is the only native dependency
# and ships prebuilds for both, so no compiler is needed.

# --------------------------------------------------------------------------
# Build: compile TypeScript to dist/ with the full dependency tree.
# --------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# --------------------------------------------------------------------------
# Runtime
# --------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# pg_dump for `npm run backup`. It must be at least the server's version, and
# Debian bookworm only carries 15, so this comes from the PostgreSQL project's
# own repository. scripts/lib/backup-common.ts finds it on PATH.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client-18; \
    apt-get purge -y curl gnupg; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Production dependencies, plus tsx: db:setup, db:migrate, rules and backup are
# TypeScript scripts run straight from source, so that the deployed container
# and a developer's machine apply exactly the same migration and backup code.
RUN set -eux; \
    npm ci --omit=dev; \
    npm install --no-save tsx@^4.23.15; \
    npm cache clean --force

COPY --from=build /app/dist ./dist
# Read at runtime by path, so they must sit beside dist/:
#   db/migrations  platform/db/migrator.ts  (MIGRATIONS_DIR)
#   assets/fonts   platform/pdf/pdf-canvas.ts  (Bengali and Latin PDF fonts)
COPY db ./db
COPY assets ./assets
# rule-packs: `npm run rules -- publish ...` reads these, relative to the workdir
COPY rule-packs ./rule-packs
# sources for the tsx scripts above
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# Uploaded documents and encrypted backups. Mounted as volumes in production;
# created here so the unprivileged user owns them either way.
RUN install -d -o node -g node /app/storage /app/backups

USER node
EXPOSE 3000

# The load balancer uses /health/ready, which also waits for migrations. This
# check is only "does the process serve HTTP", so a restart loop is visible.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
