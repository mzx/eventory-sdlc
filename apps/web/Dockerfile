# pnpm 11.x requires Node >=22.13 to run its own CLI (uses node:sqlite via
# corepack); the app's `engines` field only requires >=20, but the image
# runtime must satisfy pnpm's own requirement.
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
