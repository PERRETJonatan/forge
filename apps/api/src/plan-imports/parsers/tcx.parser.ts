import { XMLParser } from "fast-xml-parser";
import type { Discipline, WorkoutStep } from "@forge/shared";
import type { ParsedWorkout } from "../parsed-workout.js";

// Garmin TrainingCenterDatabase v2 <Workouts> schema. The base Sport_t
// enumeration only defines Running/Biking/Other — TCX has no Swim or
// Strength sport value, so those imports always land as OTHER.
function mapSport(sport: string | undefined): Discipline {
  if (sport === "Running") return "RUN";
  if (sport === "Biking") return "BIKE";
  return "OTHER";
}

interface RawDuration {
  "@_type"?: string;
  Seconds?: string | number;
  Meters?: string | number;
}

interface RawZone {
  LowInMetersPerSecond?: string | number;
  HighInMetersPerSecond?: string | number;
  LowInBeatsPerMinute?: string | number;
  HighInBeatsPerMinute?: string | number;
}

interface RawTarget {
  "@_type"?: string;
  SpeedZone?: RawZone;
  HeartRateZone?: RawZone;
}

interface RawStep {
  "@_type"?: string;
  StepId?: string | number;
  Name?: string;
  Intensity?: string;
  Duration?: RawDuration;
  Target?: RawTarget;
  Repetitions?: string | number;
  Child?: RawStep[];
}

interface RawWorkout {
  "@_Sport"?: string;
  Name?: string;
  Step?: RawStep[];
}

function parseDuration(duration: RawDuration | undefined): { durationSec?: number; distanceM?: number } {
  if (!duration) return {};
  if (duration["@_type"] === "Time_t" && duration.Seconds != null) {
    return { durationSec: Number(duration.Seconds) };
  }
  if (duration["@_type"] === "Distance_t" && duration.Meters != null) {
    return { distanceM: Number(duration.Meters) };
  }
  return {};
}

function parseTarget(target: RawTarget | undefined): {
  targetLow?: number;
  targetHigh?: number;
  targetUnit?: string;
} {
  if (!target) return {};
  if (target["@_type"] === "Speed_t" && target.SpeedZone) {
    const { LowInMetersPerSecond, HighInMetersPerSecond } = target.SpeedZone;
    if (LowInMetersPerSecond != null || HighInMetersPerSecond != null) {
      return {
        targetLow: LowInMetersPerSecond != null ? Number(LowInMetersPerSecond) : undefined,
        targetHigh: HighInMetersPerSecond != null ? Number(HighInMetersPerSecond) : undefined,
        targetUnit: "speed_m_s",
      };
    }
  }
  if (target["@_type"] === "HeartRate_t" && target.HeartRateZone) {
    const { LowInBeatsPerMinute, HighInBeatsPerMinute } = target.HeartRateZone;
    if (LowInBeatsPerMinute != null || HighInBeatsPerMinute != null) {
      return {
        targetLow: LowInBeatsPerMinute != null ? Number(LowInBeatsPerMinute) : undefined,
        targetHigh: HighInBeatsPerMinute != null ? Number(HighInBeatsPerMinute) : undefined,
        targetUnit: "hr_bpm",
      };
    }
  }
  return {};
}

function parseStep(step: RawStep): WorkoutStep {
  if (step["@_type"] === "Repeat_t") {
    const children = step.Child ?? [];
    return {
      repeat: step.Repetitions != null ? Number(step.Repetitions) : undefined,
      steps: children.map(parseStep),
    };
  }
  return {
    label: step.Name || step.Intensity,
    ...parseDuration(step.Duration),
    ...parseTarget(step.Target),
  };
}

const ARRAY_TAGS = new Set(["Workout", "Step", "Child"]);

export function parseTcx(buffer: Buffer): ParsedWorkout[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    isArray: (tagName) => ARRAY_TAGS.has(tagName),
  });
  const doc = parser.parse(buffer.toString("utf-8"));
  const rawWorkouts: RawWorkout[] = doc?.TrainingCenterDatabase?.Workouts?.Workout ?? [];

  return rawWorkouts.map((workout) => ({
    discipline: mapSport(workout["@_Sport"]),
    title: workout.Name,
    structuredIntervals: (workout.Step ?? []).map(parseStep),
  }));
}
