# Build context is the repo root (npm workspaces), see
# .github/workflows/docker-publish.yml.
FROM node:20-alpine AS build
WORKDIR /app
# puppeteer is only for Karma tests; skip its Chrome download.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace apps/web --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build --workspace apps/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist/web/browser /usr/share/nginx/html
# Regenerates env.js from $API_URL on every container start (nginx image runs
# every script in /docker-entrypoint.d/ before starting), so apiUrl is picked
# per deployment instead of baked in at build time.
COPY --chmod=755 apps/web/docker/40-env-js.sh /docker-entrypoint.d/40-env-js.sh
EXPOSE 80
