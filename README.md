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
- Milestone 3 (plan import): importers for TrainingPeaks-style CSV, ICS calendars, and structured `.fit`/`.tcx` workout files, normalized into the workout model with structured interval detail preserved where the source provides it; import is idempotent (re-importing overlapping dates updates rather than duplicates). Lives at Settings → Plan import (`apps/web/src/app/settings`), backed by `/plan-imports`.
  - The CSV importer matches a documented set of flexible header aliases (see `apps/api/src/plan-imports/parsers/csv.parser.ts`) rather than one exact TrainingPeaks export schema, since TrainingPeaks doesn't publish a single fixed CSV format — adjust the aliases if a real export doesn't match.
- Milestone 4 (calendar ICS sync): read-only calendar feed so an athlete's planned/completed
  workouts show up in their phone's calendar app (Apple/iCloud Calendar, Google Calendar,
  Outlook). Settings → Calendar sync generates a per-athlete secret feed URL
  (`GET /calendar-feed/:token.ics`, unauthenticated — calendar apps can't send a JWT, so the
  unguessable token in the path is the access control); regenerating rotates the token and
  invalidates the old URL. Backed by `apps/api/src/calendar-feed` (hand-rolled RFC 5545 writer,
  no new dependency — workouts are date-only so every event is an all-day VEVENT).
- Milestone 5 (program builder): structured workout editor at `/builder` -- assemble a workout
  from steps and one level of repeat groups (e.g. "4x (4min on, 2min off)", matching what every
  plan-import parser actually produces), targeting power/pace/HR/RPE per discipline as an
  absolute value or a %-of-threshold, with a live TSS estimate as you build
  (`packages/shared/src/tss.ts`, same `IF^2 x hours x 100` model the dashboard will use).
  Save a workout as a reusable template, apply it to a date, or repeat it weekly for N weeks;
  built workouts land in the same `workout` model as imported ones (`source: MANUAL`) and
  appear identically in calendar/list views. Backed by `AthleteThresholds` (new Settings →
  Thresholds & zones panel: FTP, threshold pace, threshold HR) and `/workout-templates`
  (`apps/api/src/workout-templates`). Coach-assisted drafting is deferred to the coach milestone.
  - Single value per target (no low/high range) and one level of repeat nesting are deliberate
    v1 simplifications -- see `apps/web/src/app/program-builder/program-builder-page.component.ts`.

Remaining roadmap (placeholder pages until then): Strava sync (milestone 6), fitness dashboard (milestone 7), virtual coach (milestone 8), settings profile/Strava tabs (later milestone).
