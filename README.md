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

There's no public signup. Create your account from the command line (it prompts for the
password), then open http://localhost:4200 and log in:

```bash
npm run athlete --workspace apps/api -- create you@example.com "Your Name"
npm run athlete --workspace apps/api -- set-password you@example.com   # forgot it / rotate it
```

## Deploying on the internet

Forge is built to face the internet directly (no SSO proxy in front). Before exposing it:

- **Secrets.** Set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` to random values
  (`openssl rand -hex 32` each). The API image runs with `NODE_ENV=production` and refuses to
  start with the `.env.example` placeholders or anything under 32 characters.
- **Accounts.** Created by you, in the API container:
  `docker exec -it <api-container> node dist/cli/athlete.js create you@example.com "Your Name"`
  (`set-password <email>` resets a password and signs that account out everywhere).
- **HTTPS.** Terminate TLS in front of the web container. It sends HSTS, so serve the site over
  HTTPS only.
- **Only the web container is public.** It serves the app and proxies `/api/` to the API; don't
  publish the API's port or Postgres.
- **`TRUST_PROXY`** (API env, default `1`): how many proxies sit between clients and the API.
  The API rate-limits per client IP and reads it from `X-Forwarded-For`. With `1`, the bundled web
  container's nginx is the only one; if you put another reverse proxy (Traefik, Caddy…) in front
  of that, set `2`. Never set it higher than the proxies you actually run: that would let a
  client forge its IP and dodge the limits. If it's too low, everyone shares one limit.
- **What's in place.**
  - Rate limits: 300 req/min per IP overall; logins 20 per 15 min per IP, plus 10 *failed* per
    15 min per account from any IP; token refreshes 60 per 15 min per IP. They're in memory, so
    they reset when the API restarts.
  - Login gives the same error, in the same time, for an unknown email as for a wrong password.
  - Passwords at least 12 characters, bcrypt-hashed; refresh tokens stored hashed and rotated on
    every use.
  - Strava connect uses a single-purpose, 10-minute OAuth `state`, not your access token.
  - Web: strict Content-Security-Policy (no inline scripts), HSTS, `nosniff`, no framing,
    `Referrer-Policy`, `Permissions-Policy`, nginx version hidden. API: helmet headers, CORS
    limited to `WEB_ORIGIN`.
- **Known limits.** The refresh token lives in `localStorage` (the CSP is the main guard against
  script injection reading it; an `httpOnly` cookie would be stronger). Strava OAuth tokens are
  stored unencrypted in Postgres.

## Testing

```bash
npm test --workspaces
```

The API tests run against the same local Postgres instance as dev (see `apps/api/tests/setup.ts`) and truncate tables between tests — make sure `docker compose up -d` and `apps/api/.env` are set up first.

## Build status

- Milestone 1 (skeleton + auth): signup/login/logout/refresh (public signup since removed -- see Deploying), JWT-protected API, authenticated app shell with placeholder pages for each feature area.
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
- Milestone 6 (Strava sync, read-only): Settings → Strava to connect (OAuth2), see last sync
  time, "Sync now", and disconnect. Syncing fetches activities since the last sync (or all-time,
  first sync), matches each to a same-date/discipline planned workout when one exists (filling
  in its actual duration/distance/intensity), or creates a new `source: STRAVA` workout
  otherwise -- either way it lands in the same calendar/list views as any other workout. A
  wrong match can be undone from the workout edit modal ("Unmatch"). Never writes back to
  Strava. Backed by `apps/api/src/strava`: `StravaConnection` (tokens, plaintext -- v1/local-dev
  simplification, see schema.prisma) and `StravaActivity` (kept as its own row, distinct from
  the workout it's matched to, so unmatching doesn't lose the synced data). The Strava HTTP
  calls sit behind an injectable `StravaClient` interface so sync/matching/token-refresh logic
  has full test coverage (17 tests) against a fake client, without hitting Strava's real API or
  needing live credentials to run the test suite.
  - Deliberately out of scope for v1: activity streams (pace/power over the activity,
    splits/laps -- a separate, per-activity Strava endpoint) and webhook-based incremental sync
    (polling via "Sync now" only).

- Milestone 7 (fitness dashboard): `/dashboard` with the Performance Management model from
  SPEC.md -- per-workout TSS rolled into CTL (fitness, 42-day), ATL (fatigue, 7-day) and TSB
  (form) over every calendar day, current values with a 7-day change, a trend chart that
  projects forward from planned workouts (dashed), weekly volume per discipline (hours or
  distance), weekly planned-vs-actual TSS, and a race-day countdown (new Settings → Target race
  panel; a race within ~4 months extends the projection to race day). Backed by
  `GET /fitness/dashboard` and `/me/race-target` (`apps/api/src/fitness`, `apps/api/src/race-target`).
  - TSS per completed workout uses the best available intensity: the matched Strava activity's
    average power (bike) / pace (run, swim) / HR (any discipline) against the athlete's
    thresholds, else the IF implied by the workout's planned steps, else an easy-effort default
    (same constant as the program builder). Strava gives averages only (no streams), so bike
    TSS uses average power rather than Normalized Power and reads slightly low on variable rides.
  - The series is computed on read from the athlete's full history rather than stored in a
    `fitness_snapshot` table: the recurrence has to be re-rolled from the start on any change
    anyway (late sync, threshold edit), and this is cheap at a single athlete's volume.
  - Deliberately deferred: peak performances (best 5K / 20-min power / etc.) -- the SPEC
    computes these from rolling windows over activity streams, which Strava sync doesn't fetch
    yet (see milestone 6).

- Plan generator (program builder → Training plan tab): generates a whole periodized plan to
  the athlete's target race from race distance (Sprint/Olympic/70.3/Ironman), start date, peak
  weekly hours, training days and long-ride/long-run days. Phases are counted back from race
  day (base → build → peak → taper → race week), with a 3:1 load/recovery rhythm and weekly
  hours ramped (≤10%/week) from what current fitness (CTL) implies up to the peak. Each week's
  hours are split across swim/bike/run by race distance and placed on available days as
  structured %-of-threshold workouts (long ride/run, quality sessions, bricks from the build
  phase, race-week openers). Preview first; "Add to calendar" writes `source: GENERATED`
  workouts. Regenerating replaces only the previous generated plan's future, not-completed
  workouts -- hand-built, imported and completed workouts are kept and their days left alone.
  Strava sync matches activities to generated workouts like any other planned workout. Backed
  by `POST /plan-generator/preview|apply` (`apps/api/src/plan-generator`: pure, deterministic
  generator + workout library, so apply writes exactly what was previewed).

- Glossary (`/glossary`): searchable definitions of the training terms the app uses (TSS, CTL/ATL/TSB,
  FTP, CSS, zones, taper, brick…), each with an "In Forge" note tying it to the app's actual
  formulas and numbers -- keep those in sync when the fitness model or plan generator change
  (`apps/web/src/app/glossary/glossary-terms.ts`). `<app-term key="…">` marks a term inline with a
  hover/focus definition linking to its entry; used in Settings, the dashboard and the builder.

Remaining roadmap (placeholder pages until then): virtual coach (milestone 8), settings profile tab (later milestone); peak performances once activity streams are synced.
