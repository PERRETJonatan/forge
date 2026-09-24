import { describe, expect, it } from "vitest";
import type { AthleteThresholds, WorkoutStep } from "../src/index.js";
import { summarizeSteps } from "../src/tss.js";

const NO_THRESHOLDS: AthleteThresholds = {
  ftpWatts: null,
  runThresholdPaceSecPerKm: null,
  swimThresholdPaceSec100m: null,
  thresholdHr: null,
};

describe("summarizeSteps", () => {
  it("sums duration/distance across leaf steps", () => {
    const steps: WorkoutStep[] = [
      { label: "Warm-up", durationSec: 600, distanceM: 2000 },
      { label: "Cool-down", durationSec: 300, distanceM: 1000 },
    ];
    const summary = summarizeSteps(steps, NO_THRESHOLDS);
    expect(summary.durationSec).toBe(900);
    expect(summary.distanceM).toBe(3000);
  });

  it("expands a repeat group, multiplying each nested step by the repeat count", () => {
    const steps: WorkoutStep[] = [
      {
        repeat: 6,
        steps: [
          { label: "On", durationSec: 240 },
          { label: "Off", durationSec: 120 },
        ],
      },
    ];
    const summary = summarizeSteps(steps, NO_THRESHOLDS);
    expect(summary.durationSec).toBe(6 * (240 + 120));
  });

  it("computes 100 TSS for exactly 1 hour at threshold power", () => {
    const thresholds: AthleteThresholds = { ...NO_THRESHOLDS, ftpWatts: 250 };
    const steps: WorkoutStep[] = [{ durationSec: 3600, targetLow: 250, targetHigh: 250, targetUnit: "power" }];
    const summary = summarizeSteps(steps, thresholds);
    expect(summary.estimatedTss).toBeCloseTo(100, 5);
  });

  it("computes IF from a percent-of-threshold target regardless of unit", () => {
    const steps: WorkoutStep[] = [{ durationSec: 1800, targetLow: 90, targetHigh: 90, targetMode: "percent" }];
    const summary = summarizeSteps(steps, NO_THRESHOLDS);
    // IF 0.9, 0.5h -> 0.81 * 0.5 * 100
    expect(summary.estimatedTss).toBeCloseTo(40.5, 5);
  });

  it("treats a faster (lower) pace as a higher IF for running", () => {
    const thresholds: AthleteThresholds = { ...NO_THRESHOLDS, runThresholdPaceSecPerKm: 240 };
    // Running at threshold pace exactly for 1h should be ~100 TSS.
    const steps: WorkoutStep[] = [{ durationSec: 3600, targetLow: 240, targetUnit: "pace_sec_per_km" }];
    const summary = summarizeSteps(steps, thresholds);
    expect(summary.estimatedTss).toBeCloseTo(100, 5);
  });

  it("falls back to an easy-effort default IF when a step has no target and no threshold", () => {
    const steps: WorkoutStep[] = [{ durationSec: 3600 }];
    const summary = summarizeSteps(steps, NO_THRESHOLDS);
    expect(summary.estimatedTss).toBeCloseTo(0.55 ** 2 * 100, 5);
  });

  it("falls back to the default IF when the needed threshold isn't set, rather than throwing", () => {
    const steps: WorkoutStep[] = [{ durationSec: 3600, targetLow: 250, targetUnit: "power" }];
    const summary = summarizeSteps(steps, NO_THRESHOLDS);
    expect(summary.estimatedTss).toBeCloseTo(0.55 ** 2 * 100, 5);
  });

  it("tracks distance-only steps as untimed distance without contributing TSS", () => {
    const steps: WorkoutStep[] = [{ label: "Easy swim", distanceM: 1000 }];
    const summary = summarizeSteps(steps, NO_THRESHOLDS);
    expect(summary.untimedDistanceM).toBe(1000);
    expect(summary.distanceM).toBe(1000);
    expect(summary.durationSec).toBe(0);
    expect(summary.estimatedTss).toBe(0);
  });
});
