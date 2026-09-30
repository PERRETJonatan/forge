import { describe, expect, it } from "vitest";
import { parseRunnaFeed } from "../../src/runna/runna-parser.js";
import { INTERVALS, LONG_RUN, OVER_UNDERS, RACE, STRENGTH, runnaFeed } from "../runna-feed.js";

describe("parseRunnaFeed", () => {
  it("takes only upcoming plan workouts, keyed by Runna's plan-day id", () => {
    const workouts = parseRunnaFeed(
      runnaFeed([
        { dayId: "plan_week_2_INTERVALS_0", date: "2026-10-07", ...INTERVALS },
        { dayId: "plan_week_1_LEGS_AND_CORE_0", date: "2026-10-01", ...STRENGTH },
      ]),
    );
    expect(workouts.map((w) => [w.externalId, w.date, w.discipline])).toEqual([
      ["plan_week_1_LEGS_AND_CORE_0", "2026-10-01", "STRENGTH"],
      ["plan_week_2_INTERVALS_0", "2026-10-07", "RUN"],
    ]);
  });

  it("reads title, distance, Runna's time estimate and keeps the description as notes", () => {
    const [w] = parseRunnaFeed(runnaFeed([{ dayId: "d1", date: "2026-10-07", ...INTERVALS }]));
    expect(w.title).toBe("1km Repeats");
    expect(w.targetDistanceM).toBe(6500);
    expect(w.targetDurationSec).toBe(3000);
    expect(w.notes).toContain("3 reps of:");
    expect(w.notes).toContain("View in the Runna app");
  });

  it("falls back to the middle of Runna's time range when there's no estimate", () => {
    const [w] = parseRunnaFeed(runnaFeed([{ dayId: "d1", date: "2026-10-07", ...INTERVALS, estimatedSec: undefined }]));
    expect(w.targetDurationSec).toBe(47.5 * 60);
  });

  it("turns interval prose into paced steps, walking rests and a repeat group", () => {
    const [w] = parseRunnaFeed(runnaFeed([{ dayId: "d1", date: "2026-10-07", ...INTERVALS }]));
    expect(w.structuredIntervals).toEqual([
      { label: "Warm-up", distanceM: 2000, durationSec: 830, targetLow: 415, targetUnit: "pace_sec_per_km", targetMode: "absolute" },
      { label: "Walk", durationSec: 90, targetLow: 2, targetUnit: "rpe" },
      {
        repeat: 3,
        steps: [
          { label: "Run", distanceM: 1000, durationSec: 355, targetLow: 345, targetHigh: 365, targetUnit: "pace_sec_per_km", targetMode: "absolute" },
          { label: "Walk", durationSec: 90, targetLow: 2, targetUnit: "rpe" },
        ],
      },
      // "a conversational pace (or slower!)" reuses the workout's "no faster than" limit.
      { label: "Cool-down", distanceM: 1500, durationSec: 623, targetLow: 415, targetUnit: "pace_sec_per_km", targetMode: "absolute" },
    ]);
  });

  it("reads a 'Repeat the following Nx' block between its rules", () => {
    const [w] = parseRunnaFeed(runnaFeed([{ dayId: "d1", date: "2026-10-07", ...OVER_UNDERS }]));
    const steps = w.structuredIntervals!;
    expect(steps.map((s) => s.label ?? `${s.repeat}x`)).toEqual(["Warm-up", "3x", "Walk", "Cool-down"]);
    expect(steps[1].steps!.map((s) => s.targetLow)).toEqual([370, 350]);
  });

  it("times a run with no pace at all from Runna's estimate, so it still counts load", () => {
    const [w] = parseRunnaFeed(runnaFeed([{ dayId: "d1", date: "2026-10-11", ...LONG_RUN }]));
    expect(w.structuredIntervals).toEqual([{ label: "Easy", distanceM: 8000, durationSec: 3300 }]);
  });

  it("turns a one-line race into a single step over the race distance", () => {
    const [w] = parseRunnaFeed(runnaFeed([{ dayId: "d1", date: "2026-12-20", ...RACE }]));
    expect(w.structuredIntervals).toEqual([
      { label: "Race", distanceM: 21100, durationSec: 8018, targetLow: 370, targetHigh: 390, targetUnit: "pace_sec_per_km", targetMode: "absolute" },
    ]);
  });

  it("turns strength sets into circuits of the listed exercises", () => {
    const [w] = parseRunnaFeed(runnaFeed([{ dayId: "d1", date: "2026-10-01", ...STRENGTH }]));
    expect(w.title).toBe("Loading Up");
    expect(w.targetDistanceM).toBeNull();
    expect(w.targetDurationSec).toBe(3900);
    expect(w.structuredIntervals).toEqual([
      { repeat: 3, steps: [{ label: "Bodyweight Squat" }, { label: "Squat to Calf Raise" }] },
      { repeat: 2, steps: [{ label: "Side Plank" }, { label: "Plank Pull Through" }] },
    ]);
  });
});
