# Project is pinned to pnpm 10.x (see root package.json "packageManager"),
# which supports Node >=18; Node 22 is used here to match the web dev
# runtime's minimum supported Node version, not a pnpm requirement.
FROM node:22-bookworm-slim
WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
RUN pnpm install --frozen-lockfile --filter=@eventory/web...

COPY apps/web ./apps/web
WORKDIR /workspace/apps/web

EXPOSE 5173
CMD ["pnpm", "run", "dev"]
