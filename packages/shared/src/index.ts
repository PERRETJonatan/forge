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

export interface SignupRequest {
  email: string;
  password: string;
  name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export type Discipline = 'SWIM' | 'BIKE' | 'RUN' | 'STRENGTH' | 'OTHER';

export type WorkoutSource = 'MANUAL' | 'IMPORT' | 'STRAVA' | 'COACH_DRAFT';

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
}

export type UpdateWorkoutRequest = Partial<CreateWorkoutRequest>;

export interface WorkoutListQuery {
  from?: string;
  to?: string;
  discipline?: Discipline;
  completed?: boolean;
}

export type PlanFormat = 'TRAININGPEAKS_CSV' | 'ICS' | 'FIT' | 'TCX';

export interface CalendarFeedStatus {
  url: string | null;
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
}

export interface StravaSyncResult {
  fetched: number;
  matchedExisting: number;
  createdNew: number;
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

export * from './tss.js';
