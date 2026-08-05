FROM node:20-bookworm-slim AS base
WORKDIR /workspace

FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm install --workspace=@eventory/api --include-workspace-root

FROM deps AS build
COPY apps/api ./apps/api
RUN npm run --workspace=@eventory/api build

FROM node:20-bookworm-slim AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
# Prisma's schema-engine binary needs libssl at runtime; bookworm-slim omits it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/prisma ./apps/api/prisma
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
WORKDIR /workspace/apps/api
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
