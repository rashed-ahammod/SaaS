# syntax=docker/dockerfile:1
#
# Employee self-service PWA (Next.js). Built for linux/amd64 and linux/arm64.
#
# The browser only ever talks to this app; it reaches the ERP API through the
# route handlers in src/app/api, which keep the login token in an httpOnly
# cookie. BACKEND_URL is therefore a server-side secret and must never be
# baked into the image — it is read at run time, not at build time.

# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# `output: 'standalone'` in next.config.ts puts a self-contained server in
# .next/standalone. Telemetry stays off.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --------------------------------------------------------------------------
# Runtime
# --------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0
WORKDIR /app

# public/ holds the service worker, icons and fonts; .next/static the compiled
# assets. The standalone server serves both but does not bundle them.
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
