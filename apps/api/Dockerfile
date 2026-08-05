# pnpm 11.x requires Node >=22.13 to run its own CLI (uses node:sqlite via
# corepack); the app's `engines` field only requires >=20, but the image
# runtime must satisfy pnpm's own requirement.
FROM node:22-bookworm-slim AS base
WORKDIR /workspace
RUN corepack enable

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
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/prisma ./apps/api/prisma
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
WORKDIR /workspace/apps/api
EXPOSE 3001
# pnpm's symlinked node_modules can trip `npx`; invoke the workspace-local
# binary directly instead of `npx prisma` / `pnpm exec prisma`.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
