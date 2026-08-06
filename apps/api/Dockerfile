# Project is pinned to pnpm 10.x (see root package.json "packageManager"),
# which supports Node >=18; Node 22 is used here to match the API runtime's
# minimum supported Node version, not a pnpm requirement.
FROM node:22-bookworm-slim AS base
WORKDIR /workspace
# openssl is needed at build time too: `prisma generate` probes it to pick
# the query-engine binary target; without it, generation falls back to the
# openssl-1.1 engine, which the (openssl-3) runtime stage cannot load.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile --filter=@eventory/api...

FROM deps AS build
COPY apps/api ./apps/api
RUN pnpm --filter=@eventory/api run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
# Prisma's schema-engine binary needs libssl at runtime; bookworm-slim omits it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
# Copy node_modules from the BUILD stage, not deps: `pnpm build` runs
# `prisma generate`, which writes the real client into node_modules. The
# deps stage only has the ungenerated stub (schema isn't present there).
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/prisma ./apps/api/prisma
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
WORKDIR /workspace/apps/api
EXPOSE 3001
# pnpm's symlinked node_modules can trip `npx`; invoke the workspace-local
# binary directly instead of `npx prisma` / `pnpm exec prisma`.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
