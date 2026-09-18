import type { Discipline } from '@forge/shared';

export const DISCIPLINES: Discipline[] = ['SWIM', 'BIKE', 'RUN', 'STRENGTH', 'OTHER'];

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  SWIM: 'Swim',
  BIKE: 'Bike',
  RUN: 'Run',
  STRENGTH: 'Strength',
  OTHER: 'Other',
};

export const DISCIPLINE_COLORS: Record<Discipline, string> = {
  SWIM: '#2f6fed',
  BIKE: '#e8603c',
  RUN: '#0e7c7b',
  STRENGTH: '#8a5cf6',
  OTHER: '#6b7280',
};
