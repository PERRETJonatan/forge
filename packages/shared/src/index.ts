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
 * A structured workout step, preserved from an imported plan format when it
 * provides one. A leaf step carries its own duration/distance/target; a
 * repeat group instead carries `repeat` + nested `steps` (e.g. "6x (4min @
 * threshold, 2min easy)" is a group with repeat: 6 and two leaf steps).
 */
export interface WorkoutStep {
  label?: string;
  durationSec?: number;
  distanceM?: number;
  targetLow?: number;
  targetHigh?: number;
  targetUnit?: string;
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
