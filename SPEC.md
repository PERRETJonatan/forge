# Forge - Ironman training tracking app

Multi-user web app for tracking Ironman (triathlon) training: import a precise plan,
log/sync actual workouts from Strava, see current fitness level, and get AI coaching
feedback from a local Ollama model.

## Users

- Multiple athletes, self-service accounts (no coach/admin roles for now).
- Each athlete's data (plans, workouts, Strava tokens, chat history) is private to them.
- Standard auth: email/password, JWT-based, password reset.

## MVP scope

All features below are in scope for v1. No feature list split into phases — see
"Out of scope for v1" at the end for things explicitly deferred.

### 1. Calendar with workouts

- Month/week/day calendar views showing planned workouts (from imported plan) and
  completed workouts (from Strava sync), by discipline (swim/bike/run/strength/other).
- Planned vs. actual shown together per day (e.g. planned 90km bike vs. actual Strava ride).
- Manual CRUD on workouts (add/edit/delete) for cases without an imported plan entry.
- List view as an alternative to calendar (same data, chronological list, filterable
  by discipline/date range/completed vs. planned).
- Workout detail view: clicking a workout opens a full planned-vs-actual comparison
  (distance/duration/target vs. actual, pace or power over the activity, splits/laps
  when available from Strava), the workout's notes/description, Strava sync status
  (matched activity link, "unmatch" action), and an edit entry point.

### 2. Plan import

- Import a structured training plan from a file, supporting:
  - TrainingPeaks CSV/export
  - ICS calendar
  - .fit / .tcx workout files
- Each importer normalizes into a common internal workout model: date, discipline,
  duration/distance, target intensity (pace/power/HR zone), structured intervals if
  present, and free-text description/notes.
- Import is idempotent per athlete: re-importing an overlapping plan updates/replaces
  rather than duplicating.
- Imported plan entries render precisely in both calendar and list views, preserving
  structured interval detail (not just a blob of text) wherever the source format
  provides it.

### 3. Program builder (create your own workouts/program in-app)

Inspired by TrainingPeaks' [Structured Workout Builder](https://help.trainingpeaks.com/hc/en-us/articles/235164967-Structured-Workout-Builder):
athletes aren't limited to importing a plan — they can build one directly in Forge.

- Structured workout editor: assemble a workout from blocks/steps (warm-up, interval,
  recovery, cool-down — repeatable sets, e.g. "6x (4min @ threshold, 2min easy)").
- Each step's target is set by whichever the discipline supports: power, pace, heart
  rate, or RPE — as an absolute value or a %-of-threshold zone.
- Targets computed dynamically from the athlete's own thresholds/zones (same values
  used by the fitness dashboard, see Formulas below), so a "Zone 3" step shows correct
  absolute pace/power/HR per athlete and stays correct if thresholds are updated later.
- Live TSS estimate for the workout as it's built, using the same TSS formulas as the
  dashboard.
- Reusable across the plan: save a workout as a template, apply it to another date, or
  repeat it on a schedule (e.g. "every Tuesday for 8 weeks") to build out a whole block.
- Built workouts live in the same unified workout model as imported ones (`source: manual`)
  and appear identically in calendar/list views and in TSS/CTL/ATL calculations.
- Coach-assisted drafting: from the program builder, the athlete can ask the virtual
  coach (see below) to draft a structured workout from a plain-language request (e.g.
  "give me a 90-minute sweet-spot ride for tomorrow") — the coach proposes steps/targets
  pre-filled into the builder for the athlete to review, edit, and save; it never
  writes directly to the calendar without that review step.
- Out of scope for v1: strength-exercise library (sets/reps/video demos), AI generation
  from a coach's freeform text without the athlete's own review step.

### 4. Strava sync (read-only)

- OAuth2 connect flow per athlete; store refresh token securely.
- Initial full historical sync + periodic incremental sync (webhook or polling) of
  activities (swim/bike/run at minimum).
- Store per activity: distance, duration, pace/power/HR (avg + streams if available),
  elevation, discipline/type.
- Match synced activities to planned workouts by date + discipline (best-effort,
  manual override possible when the match is wrong or ambiguous).
- No write-back to Strava in v1 (planned workouts are not pushed to Strava/Garmin).

### 5. Fitness dashboard

- TSS-based model: compute daily TSS per activity, roll up into CTL (fitness),
  ATL (fatigue), TSB (form) using standard exponentially-weighted formulas.
- TSS calculation needs a per-discipline basis:
  - Bike: power-based TSS when power data is available from Strava, else pace/HR-based estimate.
  - Run: pace or HR-based TSS (rTSS/hrTSS).
  - Swim: pace or duration/HR-based estimate (swim power data is rarely available).
  - Requires athlete-set thresholds (FTP, threshold pace per discipline, HR zones) as
    input, editable in a settings/profile page.
- Dashboard shows: CTL/ATL/TSB trend chart, current values, per-discipline volume
  trends (weekly/monthly hours & distance), and planned-vs-actual load comparison.
- Race day countdown: days remaining to the athlete's target race (event name + date,
  set in profile settings), shown prominently on the dashboard.
- Peak performances: for each discipline, the athlete's best-ever effort at a set of
  standard distances/durations — e.g. run: 1 mile, 5K, 10K, half marathon; bike: 5min/
  20min/1hr power (or 10K/40K time trial); swim: 100m/400m/1500m — with the value, pace,
  and date achieved. Computed from Strava activity streams (best rolling-window segment
  within each activity, not just whole-activity totals) and recalculated on every sync.

#### Formulas (standard Coggan/TrainingPeaks Performance Management model)

**Per-discipline TSS (daily input, computed per activity, summed per day):**

- Bike (power-based, preferred when Strava provides power data):
  - Normalized Power (NP): rolling 30s average power, raised to the 4th power,
    averaged over the activity, then take the 4th root of that average.
  - Intensity Factor (IF) = NP / FTP
  - `TSS = (duration_seconds x NP x IF) / (FTP x 3600) x 100`
  - Equivalently: `TSS = IF^2 x duration_hours x 100`
- Bike/Run without power (pace or HR-based estimate, e.g. rTSS/hrTSS):
  - IF = normalized (or average) pace or HR relative to threshold pace/HR
  - Same `TSS = IF^2 x duration_hours x 100` formula, substituting the
    pace/HR-derived IF for the power-derived one
- Swim: duration/HR or pace-based estimate using the same IF^2 x hours x 100 pattern,
  since swim power is rarely available from Strava
- By definition, 1 hour at threshold (FTP / threshold pace / threshold HR) = 100 TSS

**CTL (Chronic Training Load / "Fitness"), 42-day exponentially weighted average:**

- `CTL_today = CTL_yesterday + (TSS_today - CTL_yesterday) / 42`

**ATL (Acute Training Load / "Fatigue"), 7-day exponentially weighted average:**

- `ATL_today = ATL_yesterday + (TSS_today - ATL_yesterday) / 7`

**TSB (Training Stress Balance / "Form"):**

- `TSB_today = CTL_yesterday - ATL_yesterday`

Notes for implementation: days with no activity still get a TSS of 0 and must still
run through the EWMA recurrence (it's a rolling average over the calendar, not just
over workout days). Seed CTL/ATL at 0 (or a manually-entered starting value) when an
athlete's history in Forge is shorter than 42/7 days. Recompute the whole series
whenever historical TSS changes (e.g. late-arriving Strava sync, threshold edits),
since it's a recurrence and not independently reconstructible per day.

Sources: [A Coach's Guide to ATL, CTL & TSB](https://www.trainingpeaks.com/coach-blog/a-coachs-guide-to-atl-ctl-tsb/),
[What are CTL, ATL, TSB & TSS? — TrainerRoad](https://www.trainerroad.com/blog/why-tss-atl-ctl-and-tsb-matter/),
[Normalized Power — TrainingPeaks Help Center](https://help.trainingpeaks.com/hc/en-us/articles/204071804-Normalized-Power)

### 6. Virtual coach (AI, via Ollama)

- Chat interface where the athlete can ask questions about their training
  (e.g. "how's my form this week", "should I taper before Saturday's long ride").
- Backend calls a local Ollama instance (configurable model/endpoint) with a system
  prompt plus relevant context assembled server-side: recent CTL/ATL/TSB, upcoming
  planned workouts, recent completed workouts, athlete thresholds/zones.
- Workout drafting: on request, the coach can propose a structured workout (steps,
  targets, estimated TSS) using the same schema as the program builder (section 3).
  The draft opens in the builder for the athlete to review/edit/save — the coach never
  writes to the calendar directly, in chat or otherwise.
- No autonomous plan modification in v1 beyond that review-gated draft flow.
- Conversation history persisted per athlete.

### 7. Settings

Consolidates account-level and occasional-use screens that don't belong in the
primary nav flow, including plan import.

- **Profile**: name, race target (event/date), units (metric/imperial).
- **Thresholds & zones**: FTP, threshold pace (run/swim CSS), HR zones — the values
  used everywhere TSS/targets are computed (dashboard, program builder, coach).
- **Strava**: connect/disconnect, last sync time, manual "sync now".
- **Plan import**: the file-import flow (section 2) lives here as a tab, not in the
  primary sidebar nav — it's an occasional action, not a daily one.

## Technologies

- Frontend: SPA using Angular with TypeScript
- Backend: Node.js (TypeScript), REST API
- Database: PostgreSQL
- AI: local Ollama instance, called from the backend over HTTP
- Auth: JWT-based, TBD library (e.g. Passport.js with a JWT strategy)
- Deployment target for v1: local dev only (docker-compose for Postgres + Ollama
  recommended); production hosting to be decided later

## Data model (high level)

- `athlete`: account/profile, auth credentials, discipline thresholds (FTP, threshold
  pace, HR zones), target race (event name, date)
- `plan_import`: source file metadata, import timestamp, format
- `workout`: unified planned/actual record — discipline, date, duration, distance,
  target/actual intensity, structured intervals (JSON, steps/targets from the program
  builder), source (`import` | `strava` | `manual` | `coach_draft`), link to matched
  counterpart (planned <-> actual)
- `workout_template`: saved reusable structured workouts (built in the program builder
  or via the coach), owned by an athlete
- `strava_connection`: OAuth tokens, athlete link, last sync timestamp
- `fitness_snapshot`: per-day CTL/ATL/TSB per athlete (precomputed, recalculated on new data)
- `personal_best`: discipline, distance/duration label (e.g. "5K", "20min power"), value,
  pace/power, achieved date, source activity — recalculated on every Strava sync
- `coach_message`: chat history per athlete (role, content, timestamp)

## Out of scope for v1

- Coach/admin roles, multi-athlete management by a third party
- Writing planned workouts back to Strava/Garmin
- Autonomous AI plan editing (coach can draft a workout, but the athlete must review
  and save it — the coach never writes to the calendar unattended)
- Strength-exercise library (sets/reps/video demos) in the program builder
- AI-generated plans/workouts issued by a coach role for someone else (no coach role in v1)
- Cloud deployment/hosting setup
- Mobile app (web SPA only, responsive is a nice-to-have not a requirement)
