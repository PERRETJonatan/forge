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

- Milestone 1 (skeleton + auth): signup/login/logout/refresh, JWT-protected API, authenticated app shell with placeholder pages for each feature area.
- Milestone 2 (core workout model + calendar): `workout` Prisma model and REST API (`/workouts`, athlete-scoped CRUD + date/discipline/completed filtering), and a calendar page with month/list views, filters, and an add/edit/delete form for manual workouts.

Remaining roadmap (placeholder pages until then): plan import (milestone 3), program builder (milestone 4), Strava sync (milestone 5), fitness dashboard (milestone 6), virtual coach (milestone 7), settings (later milestone).
