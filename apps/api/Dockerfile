# Build context is the repo root (npm workspaces: the lockfile and every
# workspace's package.json live there), see .github/workflows/docker-publish.yml.
FROM node:20-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace apps/api --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run prisma:generate --workspace apps/api && npm run build --workspace apps/api

FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --workspace apps/api && npm cache clean --force
COPY apps/api/prisma apps/api/prisma
RUN npx --workspace apps/api prisma generate
COPY --from=build /app/apps/api/dist apps/api/dist

WORKDIR /app/apps/api
EXPOSE 3000
# Apply pending migrations on every start -- migrate deploy only runs
# committed migrations, never resets or drops data.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
