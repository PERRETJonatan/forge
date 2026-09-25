import type { AthleteThresholds } from "@forge/shared";
import { describe, expect, it } from "vitest";
import {
  actualTss,
  measuredIntensityFactor,
  plannedTss,
  rollLoad,
  weekStart,
  type TssWorkout,
} from "../src/fitness/fitness-model.js";

const NO_THRESHOLDS: AthleteThresholds = {
  ftpWatts: null,
  runThresholdPaceSecPerKm: null,
  swimThresholdPaceSec100m: null,
  thresholdHr: null,
};

const THRESHOLDS: AthleteThresholds = {
  ftpWatts: 250,
  runThresholdPaceSecPerKm: 240,
  swimThresholdPaceSec100m: 100,
  thresholdHr: 170,
};

function workout(overrides: Partial<TssWorkout> = {}): TssWorkout {
  return {
    discipline: "BIKE",
    source: "MANUAL",
    completed: true,
    targetDurationSec: null,
    actualDurationSec: 3600,
    structuredIntervals: null,
    activity: null,
    ...overrides,
  };
}

describe("measuredIntensityFactor", () => {
  const activity = { avgWatts: null, avgHr: null, avgSpeedMps: null };

  it("uses average power against FTP on the bike", () => {
    expect(measuredIntensityFactor("BIKE", { ...activity, avgWatts: 200 }, THRESHOLDS)).toBeCloseTo(0.8);
  });

  it("uses pace against threshold pace for a run (faster than threshold = IF above 1)", () => {
    // 4:00/km threshold, run at 1000/240 m/s (exactly 4:00/km) -> IF 1.
    expect(measuredIntensityFactor("RUN", { ...activity, avgSpeedMps: 1000 / 240 }, THRESHOLDS)).toBeCloseTo(1);
    expect(measuredIntensityFactor("RUN", { ...activity, avgSpeedMps: 1000 / 200 }, THRESHOLDS)).toBeCloseTo(1.2);
  });

  it("uses pace against CSS for a swim", () => {
    // 1:40/100m CSS, swim at 2:00/100m -> IF 100/120.
    expect(measuredIntensityFactor("SWIM", { ...activity, avgSpeedMps: 100 / 120 }, THRESHOLDS)).toBeCloseTo(100 / 120);
  });

  it("falls back to heart rate when the discipline's primary metric is missing", () => {
    expect(measuredIntensityFactor("BIKE", { ...activity, avgHr: 136 }, THRESHOLDS)).toBeCloseTo(0.8);
    expect(measuredIntensityFactor("STRENGTH", { ...activity, avgHr: 119 }, THRESHOLDS)).toBeCloseTo(0.7);
  });

  it("returns null without a matching threshold, or without an activity at all", () => {
    expect(measuredIntensityFactor("BIKE", { ...activity, avgWatts: 200 }, NO_THRESHOLDS)).toBeNull();
    expect(measuredIntensityFactor("BIKE", null, THRESHOLDS)).toBeNull();
  });
});

describe("actualTss", () => {
  it("is 100 for one hour at FTP", () => {
    const tss = actualTss(workout({ activity: { avgWatts: 250, avgHr: null, avgSpeedMps: null } }), THRESHOLDS);
    expect(tss).toBeCloseTo(100);
  });

  it("is 0 for a workout that isn't completed", () => {
    expect(actualTss(workout({ completed: false }), THRESHOLDS)).toBe(0);
  });

  it("uses the planned steps' intensity when nothing was measured", () => {
    const tss = actualTss(
      workout({ structuredIntervals: [{ durationSec: 3600, targetLow: 90, targetMode: "percent" }] }),
      THRESHOLDS,
    );
    expect(tss).toBeCloseTo(81);
  });

  it("falls back to the planned duration when only 'completed' was ticked", () => {
    const tss = actualTss(
      workout({ actualDurationSec: null, targetDurationSec: 7200, activity: { avgWatts: 250, avgHr: null, avgSpeedMps: null } }),
      THRESHOLDS,
    );
    expect(tss).toBeCloseTo(200);
  });

  it("uses an easy-effort default IF with no measurement and no plan", () => {
    expect(actualTss(workout(), NO_THRESHOLDS)).toBeCloseTo(0.55 ** 2 * 100);
  });

  it("caps an implausible measured IF", () => {
    const tss = actualTss(workout({ activity: { avgWatts: 2500, avgHr: null, avgSpeedMps: null } }), THRESHOLDS);
    expect(tss).toBeCloseTo(1.5 ** 2 * 100);
  });
});

describe("plannedTss", () => {
  it("estimates from structured steps, same as the program builder", () => {
    const tss = plannedTss(
      workout({ completed: false, actualDurationSec: null, structuredIntervals: [{ durationSec: 3600, targetLow: 250, targetUnit: "power" }] }),
      THRESHOLDS,
    );
    expect(tss).toBeCloseTo(100);
  });

  it("uses the default IF for a plan with only a target duration", () => {
    const tss = plannedTss(workout({ completed: false, actualDurationSec: null, targetDurationSec: 3600 }), THRESHOLDS);
    expect(tss).toBeCloseTo(0.55 ** 2 * 100);
  });

  it("is 0 for an unplanned (Strava-created) workout", () => {
    expect(plannedTss(workout({ source: "STRAVA", targetDurationSec: 3600 }), THRESHOLDS)).toBe(0);
  });
});

describe("rollLoad", () => {
  it("converges toward a constant daily load at the 42/7-day rates", () => {
    const tssByDay = new Map<string, number>();
    const start = "2026-01-01";
    const days = rollLoad(new Map(), start, "2026-02-11"); // 42 days
    for (const d of days) tssByDay.set(d.date, 100);

    const rolled = rollLoad(tssByDay, start, "2026-02-11");
    expect(rolled).toHaveLength(42);
    expect(rolled[41].ctl).toBeCloseTo(100 * (1 - (41 / 42) ** 42), 5);
    expect(rolled[6].atl).toBeCloseTo(100 * (1 - (6 / 7) ** 7), 5);
  });

  it("computes TSB from the previous day's CTL and ATL", () => {
    const rolled = rollLoad(new Map([["2026-01-01", 100]]), "2026-01-01", "2026-01-02");
    expect(rolled[0].tsb).toBe(0);
    expect(rolled[1].tsb).toBeCloseTo(100 / 42 - 100 / 7, 5);
  });

  it("keeps decaying through rest days that have no entry", () => {
    const rolled = rollLoad(new Map([["2026-01-01", 100]]), "2026-01-01", "2026-01-08");
    expect(rolled[7].tss).toBe(0);
    expect(rolled[7].atl).toBeCloseTo((100 / 7) * (6 / 7) ** 7, 5);
    expect(rolled[7].atl).toBeLessThan(rolled[1].atl);
  });
});

describe("weekStart", () => {
  it("returns the Monday of the week", () => {
    expect(weekStart("2026-09-25")).toBe("2026-09-21"); // Friday
    expect(weekStart("2026-09-21")).toBe("2026-09-21"); // Monday
    expect(weekStart("2026-09-27")).toBe("2026-09-21"); // Sunday
  });
});
