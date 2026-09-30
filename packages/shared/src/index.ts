export interface Athlete {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export type Discipline = 'SWIM' | 'BIKE' | 'RUN' | 'STRENGTH' | 'OTHER';

export type WorkoutSource = 'MANUAL' | 'IMPORT' | 'STRAVA' | 'COACH_DRAFT' | 'GENERATED' | 'RUNNA';

/**
 * Unit a step's target is expressed in. Imported plans can carry whatever unit the source
 * format used (see the plan-import parsers); the program builder only ever writes one of
 * these four, since those are the only quantities a threshold can convert to/from an IF.
 */
export type WorkoutStepTargetUnit = 'power' | 'pace_sec_per_km' | 'pace_sec_per_100m' | 'hr' | 'rpe' | string;

/**
 * Whether targetLow/targetHigh are the literal value (`'absolute'`, e.g. 250 W) or a
 * percentage of the athlete's threshold for that unit (`'percent'`, e.g. 90 meaning 90% FTP).
 * Undefined (imported steps) is treated as absolute.
 */
export type WorkoutStepTargetMode = 'absolute' | 'percent';

/**
 * A structured workout step, preserved from an imported plan format when it
 * provides one, or authored in the program builder. A leaf step carries its
 * own duration/distance/target; a repeat group instead carries `repeat` +
 * nested `steps` (e.g. "6x (4min @ threshold, 2min easy)" is a group with
 * repeat: 6 and two leaf steps).
 *
 * A leaf with any of `sets`/`reps`/`loadKg`/`restSec` is a gym exercise (see isExerciseStep): `label` names the
 * exercise, `durationSec` (if set) is the time of *one* set -- a timed hold like a plank --
 * and the step's total time is derived from sets x (work + rest). Inside a repeat group an
 * exercise usually omits `sets`: the group's `repeat` is the circuit's rounds.
 */
export interface WorkoutStep {
  label?: string;
  durationSec?: number;
  distanceM?: number;
  targetLow?: number;
  targetHigh?: number;
  targetUnit?: WorkoutStepTargetUnit;
  targetMode?: WorkoutStepTargetMode;
  repeat?: number;
  steps?: WorkoutStep[];
  sets?: number;
  reps?: number;
  loadKg?: number;
  /** Rest after each set, exercise steps only. */
  restSec?: number;
}

export interface Workout {
  id: string;
  discipline: Discipline;
  date: string;
  source: WorkoutSource;
  title: string | null;
  notes: string | null;
  targetDurationSec: number | null;
  targetDistanceM: number | null;
  targetIntensity: string | null;
  actualDurationSec: number | null;
  actualDistanceM: number | null;
  actualIntensity: string | null;
  structuredIntervals: WorkoutStep[] | null;
  completed: boolean;
  planImportId: string | null;
  /** Id of the matched StravaActivity, if any -- lets the UI offer "unmatch". */
  stravaActivityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkoutRequest {
  discipline: Discipline;
  date: string;
  title?: string | null;
  notes?: string | null;
  targetDurationSec?: number | null;
  targetDistanceM?: number | null;
  targetIntensity?: string | null;
  actualDurationSec?: number | null;
  actualDistanceM?: number | null;
  actualIntensity?: string | null;
  structuredIntervals?: WorkoutStep[] | null;
  completed?: boolean;
  /** Only MANUAL (default) or COACH_DRAFT, for a coach draft the athlete reviewed and saved. */
  source?: Extract<WorkoutSource, 'MANUAL' | 'COACH_DRAFT'>;
}

export type UpdateWorkoutRequest = Partial<Omit<CreateWorkoutRequest, 'source'>>;

export interface WorkoutListQuery {
  from?: string;
  to?: string;
  discipline?: Discipline;
  completed?: boolean;
}

export type PlanFormat = 'TRAININGPEAKS_CSV' | 'ICS' | 'FIT' | 'TCX';

export interface CalendarFeedStatus {
  /** Every workout, or null while calendar sync is off. */
  url: string | null;
  /**
   * One feed per discipline, on the same token: calendar apps color by calendar, not by event,
   * so subscribing to each sport separately is how swims, rides and runs get their own color.
   * Empty while calendar sync is off.
   */
  sports: { discipline: Discipline; url: string }[];
}

export interface PlanImport {
  id: string;
  filename: string;
  format: PlanFormat;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  warnings: string[];
  importedAt: string;
}

/**
 * Athlete-set thresholds: FTP, threshold pace per discipline, threshold HR. Used to compute
 * absolute per-athlete targets from a %-of-threshold step (program builder) and per-activity
 * TSS for the dashboard -- same values, both places (see SPEC.md,
 * Formulas). All null until the athlete sets them in Settings.
 */
export interface AthleteThresholds {
  ftpWatts: number | null;
  runThresholdPaceSecPerKm: number | null;
  swimThresholdPaceSec100m: number | null;
  thresholdHr: number | null;
}

export type UpdateAthleteThresholdsRequest = Partial<AthleteThresholds>;

export interface WorkoutTemplate {
  id: string;
  name: string;
  discipline: Discipline;
  steps: WorkoutStep[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkoutTemplateRequest {
  name: string;
  discipline: Discipline;
  steps: WorkoutStep[];
}

export type UpdateWorkoutTemplateRequest = Partial<CreateWorkoutTemplateRequest>;

export interface ApplyWorkoutTemplateRequest {
  date: string;
}

export interface StravaStatus {
  connected: boolean;
  stravaAthleteId: string | null;
  lastSyncAt: string | null;
  /** Why the last sync failed, or null if it succeeded. Syncs also run in the background. */
  lastSyncError: string | null;
}

export interface StravaSyncResult {
  fetched: number;
  matchedExisting: number;
  createdNew: number;
}

/** The athlete's Runna plan link (see apps/api/src/runna). `feedUrl` is null when not connected. */
export interface RunnaStatus {
  feedUrl: string | null;
  lastSyncAt: string | null;
  /** Why the last sync failed, or null if it succeeded. */
  lastSyncError: string | null;
}

export interface RunnaSyncResult {
  /** Upcoming workouts in the Runna plan. */
  inFeed: number;
  created: number;
  updated: number;
  /** Future workouts dropped from the Runna plan, deleted from Forge. */
  removed: number;
}

/** The athlete's target race, shown as a countdown on the dashboard. Both null until set. */
export interface RaceTarget {
  raceName: string | null;
  raceDate: string | null;
}

export type UpdateRaceTargetRequest = Partial<RaceTarget>;

/**
 * One calendar day of the Performance Management model (see SPEC.md, Formulas). Days up to
 * and including `today` roll actual TSS from completed workouts; later days are `projected`,
 * rolling the planned TSS of workouts on the calendar instead.
 */
export interface FitnessDay {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
  projected: boolean;
}

export interface DisciplineVolume {
  durationSec: number;
  distanceM: number;
}

/** A Monday-start week: completed volume per discipline plus planned vs actual TSS. */
export interface FitnessWeek {
  weekStart: string;
  plannedTss: number;
  actualTss: number;
  volume: Record<Discipline, DisciplineVolume>;
}

export interface FitnessDashboard {
  today: string;
  current: { ctl: number; atl: number; tsb: number };
  series: FitnessDay[];
  weeks: FitnessWeek[];
  race: RaceTarget;
  /** Thresholds not set yet -- TSS for those disciplines falls back to a coarser estimate. */
  missingThresholds: (keyof AthleteThresholds)[];
}

export interface FitnessDashboardQuery {
  from?: string;
  to?: string;
  today?: string;
}

export type RaceDistance = 'SPRINT' | 'OLYMPIC' | 'HALF' | 'FULL';

export type TrainingPhase = 'BASE' | 'BUILD' | 'PEAK' | 'TAPER' | 'RACE';

/** Weekday index, Monday = 0 ... Sunday = 6 (same convention as the calendar grid). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface PlanGenerationRequest {
  /** First day of the plan; the race date comes from the athlete's race target. */
  startDate: string;
  raceDistance: RaceDistance;
  /** Hours in the biggest (peak) week; the plan ramps up to this from current fitness. */
  maxWeeklyHours: number;
  trainingDays: Weekday[];
  longRideDay: Weekday;
  longRunDay: Weekday;
  /** Gym sessions in a normal base/build week; the generator scales this down by phase. */
  strengthSessionsPerWeek: 0 | 1 | 2;
  /**
   * Running and strength come from the athlete's Runna plan (see RunnaStatus): the generator
   * plans only swim and bike, fits them around the Runna workouts and counts their hours.
   * `longRunDay` and `strengthSessionsPerWeek` are ignored then. Defaults to false.
   */
  runningFromRunna?: boolean;
}

export interface GeneratedWorkout {
  date: string;
  discipline: Discipline;
  title: string;
  notes: string;
  targetDurationSec: number;
  structuredIntervals: WorkoutStep[];
  estimatedTss: number;
}

export interface GeneratedWeek {
  weekStart: string;
  phase: TrainingPhase;
  recovery: boolean;
  /** Hours of the generated workouts only (see runnaHours). */
  plannedHours: number;
  /** Hours of the athlete's Runna workouts this week, when running comes from Runna; else 0. */
  runnaHours: number;
  plannedTss: number;
  workouts: GeneratedWorkout[];
}

export interface PlanPreview {
  raceName: string | null;
  raceDate: string;
  /** Weekly hours the plan starts from, derived from current fitness (CTL). */
  startingHours: number;
  weeks: GeneratedWeek[];
  /** Future, not-completed workouts from a previous generated plan that applying would replace. */
  replacesCount: number;
  /** Dates left alone because a hand-built/imported (or completed) workout is already there. */
  keptDates: string[];
}

/**
 * Usual peak-week hours for an age-group athlete, per race distance: the range the plan
 * generator suggests from and shows as guidance next to the "Peak week" field.
 */
export const TYPICAL_PEAK_HOURS: Record<RaceDistance, [number, number]> = {
  SPRINT: [5, 8],
  OLYMPIC: [7, 10],
  HALF: [10, 14],
  FULL: [13, 18],
};

/** What the plan generator's form pre-fills from: current training and the Runna plan, if any. */
export interface PlanGeneratorDefaults {
  /** Weekly hours the athlete's current fitness (CTL) corresponds to. */
  currentWeeklyHours: number;
  /** Suggested peak-week hours per race distance: planning everything, and with running from Runna. */
  suggestedPeakHours: Record<RaceDistance, { planned: number; withRunna: number | null }>;
  /** Last upcoming Runna workout, i.e. when the Runna plan ends; null without one. */
  runnaPlanEnd: string | null;
  /** Hours of the Runna plan's biggest week (runs and gym); null without a Runna plan. */
  runnaPeakWeekHours: number | null;
}

export interface PlanApplyResult {
  created: number;
  deleted: number;
}

/**
 * A structured workout the virtual coach proposes, in the program builder's schema. It is
 * only ever a proposal: the athlete opens it in the builder to review, edit and save it --
 * the coach never writes to the calendar itself.
 */
export interface CoachWorkoutDraft {
  title: string;
  discipline: Discipline;
  /** Suggested day, if the athlete asked for one ("tomorrow", "Saturday"). */
  date: string | null;
  steps: WorkoutStep[];
  durationSec: number;
  /** Computed server-side from the steps and the athlete's thresholds, not by the model. */
  estimatedTss: number;
}

export type CoachRole = 'USER' | 'ASSISTANT';

export interface CoachMessage {
  id: string;
  role: CoachRole;
  content: string;
  draft: CoachWorkoutDraft | null;
  createdAt: string;
}

export interface SendCoachMessageRequest {
  content: string;
  /** The client's calendar day, so "tomorrow" and "this week" follow the athlete's timezone. */
  today?: string;
}

/** The athlete's message and the coach's reply, both as stored. */
export interface SendCoachMessageResponse {
  message: CoachMessage;
  reply: CoachMessage;
}

export interface CoachDraftRequest {
  /** Plain-language request, e.g. "a 90-minute sweet-spot ride for tomorrow". */
  request: string;
  discipline?: Discipline;
  today?: string;
}

export interface CoachDraftResponse {
  /** The coach's short explanation of the workout. */
  note: string;
  draft: CoachWorkoutDraft;
}

export interface CoachStatus {
  model: string;
  /** Whether the Ollama server answered and has the configured model pulled. */
  available: boolean;
  error: string | null;
}

export * from './tss.js';
