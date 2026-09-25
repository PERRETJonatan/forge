import type { Discipline } from "@prisma/client";
import type { StravaActivityDto } from "./strava-client.js";

const TYPE_TO_DISCIPLINE: Record<string, Discipline> = {
  Run: "RUN",
  TrailRun: "RUN",
  VirtualRun: "RUN",
  Ride: "BIKE",
  VirtualRide: "BIKE",
  GravelRide: "BIKE",
  MountainBikeRide: "BIKE",
  EBikeRide: "BIKE",
  Swim: "SWIM",
  WeightTraining: "STRENGTH",
  Workout: "STRENGTH",
  Crossfit: "STRENGTH",
};

/** Maps Strava's (many) activity types to this app's five disciplines; anything unrecognized
 * still gets recorded, just generically -- see SPEC.md, "swim/bike/run at minimum". */
export function disciplineForStravaType(activity: Pick<StravaActivityDto, "type" | "sport_type">): Discipline {
  return TYPE_TO_DISCIPLINE[activity.sport_type ?? activity.type] ?? "OTHER";
}

/** Free-text summary for Workout.actualIntensity, matching how imported/manual workouts already use that field. */
export function summarizeIntensity(activity: StravaActivityDto): string | null {
  if (activity.average_watts) return `${Math.round(activity.average_watts)}W avg`;
  if (activity.average_heartrate) return `${Math.round(activity.average_heartrate)}bpm avg`;
  if (activity.average_speed) {
    const paceSecPerKm = 1000 / activity.average_speed;
    const minutes = Math.floor(paceSecPerKm / 60);
    const seconds = Math.round(paceSecPerKm % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")}/km avg`;
  }
  return null;
}
