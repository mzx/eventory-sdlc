FROM node:20-bookworm-slim
WORKDIR /workspace

COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
RUN npm install --workspace=@eventory/web --include-workspace-root

COPY apps/web ./apps/web
WORKDIR /workspace/apps/web

EXPOSE 5173
CMD ["npm", "run", "dev"]
