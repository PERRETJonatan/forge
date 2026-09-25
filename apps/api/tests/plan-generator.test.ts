import { summarizeSteps, type GeneratedWeek, type Weekday } from "@forge/shared";
import { describe, expect, it } from "vitest";
import { addDays } from "../src/fitness/fitness-model.js";
import { generatePlan, planWeeks, startingHoursFromCtl, type GeneratorInput } from "../src/plan-generator/plan-generator.js";

const NO_THRESHOLDS = { ftpWatts: null, runThresholdPaceSecPerKm: null, swimThresholdPaceSec100m: null, thresholdHr: null };

// 2026-09-28 is a Monday; 2027-02-14 a Sunday -- 20 weeks.
function input(overrides: Partial<GeneratorInput> = {}): GeneratorInput {
  return {
    startDate: "2026-09-28",
    raceDate: "2027-02-14",
    distance: "FULL",
    maxWeeklyHours: 12,
    startingHours: 6,
    trainingDays: [1, 2, 3, 4, 5, 6],
    longRideDay: 5,
    longRunDay: 6,
    blockedDates: new Set(),
    ...overrides,
  };
}

function weekday(date: string): Weekday {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) as Weekday;
}

function allWorkouts(weeks: GeneratedWeek[]) {
  return weeks.flatMap((w) => w.workouts);
}

describe("planWeeks", () => {
  it("counts phases back from race day: base, build, 3 peak, 2 taper, race week", () => {
    const phases = planWeeks(input()).map((w) => w.phase);
    expect(phases).toHaveLength(20);
    expect(phases.slice(-6)).toEqual(["PEAK", "PEAK", "PEAK", "TAPER", "TAPER", "RACE"]);
    expect(phases[0]).toBe("BASE");
    expect(phases).toContain("BUILD");
    // Phases never go backwards.
    const order = ["BASE", "BUILD", "PEAK", "TAPER", "RACE"];
    for (let i = 1; i < phases.length; i++) {
      expect(order.indexOf(phases[i])).toBeGreaterThanOrEqual(order.indexOf(phases[i - 1]));
    }
  });

  it("drops the earliest phases first when there's little time", () => {
    const phases = planWeeks(input({ startDate: "2027-01-25" })).map((w) => w.phase);
    expect(phases).toEqual(["TAPER", "TAPER", "RACE"]);
  });

  it("makes every 4th base/build week a lighter recovery week", () => {
    const weeks = planWeeks(input());
    const loadPhases = weeks.filter((w) => w.phase === "BASE" || w.phase === "BUILD");
    loadPhases.forEach((w, i) => expect(w.recovery).toBe(i % 4 === 3));
    for (let i = 1; i < weeks.length; i++) {
      if (weeks[i].recovery) expect(weeks[i].hours).toBeLessThan(weeks[i - 1].hours);
    }
  });

  it("ramps load weeks by at most 10% and never past the peak hours", () => {
    const load = planWeeks(input()).filter((w) => !w.recovery && (w.phase === "BASE" || w.phase === "BUILD" || w.phase === "PEAK"));
    expect(load[0].hours).toBeCloseTo(6);
    for (let i = 1; i < load.length; i++) {
      expect(load[i].hours).toBeLessThanOrEqual(load[i - 1].hours * 1.1 + 1e-9);
      expect(load[i].hours).toBeLessThanOrEqual(12 + 1e-9);
    }
    expect(load.at(-1)!.hours).toBeCloseTo(12);
  });

  it("scales a mid-week start to the days it covers", () => {
    const [first] = planWeeks(input({ startDate: "2026-10-01" })); // Thursday: 4 of 7 days
    expect(first.hours).toBeCloseTo((6 * 4) / 7);
  });
});

describe("generatePlan", () => {
  const weeks = generatePlan(input());
  const workouts = allWorkouts(weeks);

  it("only schedules on training days, before race day", () => {
    for (const w of workouts) {
      expect([1, 2, 3, 4, 5, 6]).toContain(weekday(w.date));
      expect(w.date >= "2026-09-28" && w.date < "2027-02-14").toBe(true);
    }
  });

  it("keeps the day before the race free", () => {
    expect(workouts.some((w) => w.date === "2027-02-13")).toBe(false);
  });

  it("never schedules more than two sessions a day, or two of one discipline", () => {
    const byDay = new Map<string, string[]>();
    for (const w of workouts) byDay.set(w.date, [...(byDay.get(w.date) ?? []), w.discipline]);
    for (const disciplines of byDay.values()) {
      expect(disciplines.length).toBeLessThanOrEqual(2);
      expect(new Set(disciplines).size).toBe(disciplines.length);
    }
  });

  it("puts the long ride and long run on the chosen days", () => {
    const longRides = workouts.filter((w) => w.title.startsWith("Long ride"));
    const longRuns = workouts.filter((w) => w.title.startsWith("Long run"));
    expect(longRides.length).toBeGreaterThan(10);
    longRides.forEach((w) => expect(weekday(w.date)).toBe(5));
    longRuns.forEach((w) => expect(weekday(w.date)).toBe(6));
  });

  it("leaves blocked dates alone", () => {
    const blocked = new Set(["2026-10-03", "2026-10-06"]); // a Saturday (long ride day) and a Tuesday
    const plan = allWorkouts(generatePlan(input({ blockedDates: blocked })));
    expect(plan.some((w) => blocked.has(w.date))).toBe(false);
    // The long ride still happens that week, just on another day.
    expect(plan.some((w) => w.title.startsWith("Long ride") && w.date >= "2026-09-28" && w.date <= "2026-10-04")).toBe(true);
  });

  it("builds structured steps whose duration and TSS match the workout's", () => {
    for (const w of workouts) {
      const summary = summarizeSteps(w.structuredIntervals, NO_THRESHOLDS);
      expect(summary.durationSec).toBe(w.targetDurationSec);
      expect(Math.round(summary.estimatedTss)).toBe(w.estimatedTss);
      expect(w.targetDurationSec % 60).toBe(0);
    }
  });

  it("delivers roughly the planned hours in normal weeks", () => {
    const plans = planWeeks(input());
    weeks.forEach((week, i) => {
      if (week.phase === "RACE") return;
      expect(week.plannedHours).toBeGreaterThan(plans[i].hours * 0.85);
      expect(week.plannedHours).toBeLessThan(plans[i].hours * 1.15);
    });
  });

  it("adds race-specific work only once the build starts", () => {
    const base = weeks.filter((w) => w.phase === "BASE" && !w.recovery).flatMap((w) => w.workouts);
    const peak = weeks.filter((w) => w.phase === "PEAK").flatMap((w) => w.workouts);
    expect(base.some((w) => w.title === "Brick run")).toBe(false);
    expect(peak.some((w) => w.title === "Brick run")).toBe(true);
    expect(peak.some((w) => w.title.includes("race-pace"))).toBe(true);
  });

  it("fits a plan into as few as three training days", () => {
    const plan = generatePlan(input({ trainingDays: [1, 5, 6] }));
    const dates = allWorkouts(plan).map((w) => weekday(w.date));
    expect(new Set(dates)).toEqual(new Set([1, 5, 6]));
  });

  it("is deterministic", () => {
    expect(generatePlan(input())).toEqual(weeks);
  });

  it("works for every race distance", () => {
    for (const distance of ["SPRINT", "OLYMPIC", "HALF", "FULL"] as const) {
      const plan = generatePlan(input({ distance, raceDate: addDays("2026-09-28", 12 * 7 + 6), maxWeeklyHours: 8 }));
      expect(plan.at(-1)!.phase).toBe("RACE");
      expect(allWorkouts(plan).length).toBeGreaterThan(40);
    }
  });
});

describe("startingHoursFromCtl", () => {
  it("converts CTL to weekly hours within 40-85% of the peak", () => {
    expect(startingHoursFromCtl(0, 12)).toBeCloseTo(4.8);
    expect(startingHoursFromCtl(50, 12)).toBeCloseTo(7);
    expect(startingHoursFromCtl(200, 12)).toBeCloseTo(10.2);
  });
});
