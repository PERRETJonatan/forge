# Forge

Ironman training tracking app. See [SPEC.md](./SPEC.md) for the full feature spec.

## Repo layout

npm workspaces monorepo:

- `apps/api` — Node/Express + TypeScript backend, Prisma + PostgreSQL.
- `apps/web` — Angular frontend.
- `packages/shared` — TypeScript types shared between `api` and `web`.

## Getting started

```bash
npm install
docker compose up -d          # starts Postgres
cp apps/api/.env.example apps/api/.env
npm run prisma:migrate --workspace apps/api
npm run dev                   # runs api (port 3000) and web (port 4200)
```

Then open http://localhost:4200 and sign up for an account.

## Testing

```bash
npm test --workspaces
```

The API tests run against the same local Postgres instance as dev (see `apps/api/tests/setup.ts`) and truncate tables between tests — make sure `docker compose up -d` and `apps/api/.env` are set up first.

## Build status

Milestone 1 (skeleton + auth) is implemented: signup/login/logout/refresh, JWT-protected API, and an authenticated app shell with placeholder pages for each feature area. See the build plan in this session's history for the full milestone roadmap.
