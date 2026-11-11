# syntax=docker/dockerfile:1
# Multi-target image for the CampusWatch backend. Build from the repository root:
#   docker build -f infra/docker/Dockerfile --target api -t campuswatch-api .
#   docker build -f infra/docker/Dockerfile --target worker -t campuswatch-worker .
#   docker build -f infra/docker/Dockerfile --target migrate -t campuswatch-migrate .
# Images contain no secrets: all configuration comes from the environment at runtime.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@campuswatch/api... --filter=@campuswatch/worker... --filter=@campuswatch/db...
# Self-contained production bundles (workspace packages included, dev dependencies excluded).
RUN pnpm deploy --legacy --filter=@campuswatch/api --prod /out/api \
 && pnpm deploy --legacy --filter=@campuswatch/worker --prod /out/worker \
 && pnpm deploy --legacy --filter=@campuswatch/db --prod /out/db

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache tini
WORKDIR /app
USER node
ENTRYPOINT ["/sbin/tini", "--"]

FROM runtime AS api
COPY --from=build --chown=node:node /out/api /app
ENV API_HOST=0.0.0.0 API_PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "dist/main.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker /app
CMD ["node", "dist/main.js"]

# One-shot job: applies pending SQL migrations, then exits.
FROM runtime AS migrate
COPY --from=build --chown=node:node /out/db /app
CMD ["node", "dist/cli.js"]
