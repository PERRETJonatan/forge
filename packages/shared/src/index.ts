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
  completed: boolean;
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
