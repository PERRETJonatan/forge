import type { RaceDistance, TrainingPhase, WorkoutStep, WorkoutStepTargetUnit } from "@forge/shared";

/**
 * Structured workouts for the plan generator. Every target is a %-of-threshold (the same
 * targetMode the program builder writes), so a generated workout shows the athlete's own
 * absolute power/pace in the builder and calendar, and its TSS estimate is exact regardless of
 * which thresholds are set -- percent targets *are* the intensity factor.
 */

export type SessionKind =
  | "LONG_RIDE"
  | "BIKE_QUALITY"
  | "BIKE_ENDURANCE"
  | "LONG_RUN"
  | "RUN_QUALITY"
  | "RUN_EASY"
  | "BRICK_RUN"
  | "SWIM_TECHNIQUE"
  | "SWIM_ENDURANCE"
  | "SWIM_QUALITY"
  | "SWIM_OPENER"
  | "BIKE_OPENER"
  | "RUN_OPENER";

type TriDiscipline = "SWIM" | "BIKE" | "RUN";

export const SESSION_DISCIPLINE: Record<SessionKind, TriDiscipline> = {
  LONG_RIDE: "BIKE",
  BIKE_QUALITY: "BIKE",
  BIKE_ENDURANCE: "BIKE",
  BIKE_OPENER: "BIKE",
  LONG_RUN: "RUN",
  RUN_QUALITY: "RUN",
  RUN_EASY: "RUN",
  BRICK_RUN: "RUN",
  RUN_OPENER: "RUN",
  SWIM_TECHNIQUE: "SWIM",
  SWIM_ENDURANCE: "SWIM",
  SWIM_QUALITY: "SWIM",
  SWIM_OPENER: "SWIM",
};

export interface SessionContext {
  phase: TrainingPhase;
  recovery: boolean;
  distance: RaceDistance;
}

export interface SessionPlan {
  title: string;
  notes: string;
  steps: WorkoutStep[];
}

const UNIT: Record<TriDiscipline, WorkoutStepTargetUnit> = {
  SWIM: "pace_sec_per_100m",
  BIKE: "power",
  RUN: "pace_sec_per_km",
};

/** Intensity zones as % of threshold (= intensity factor), per discipline. */
const ZONE = {
  BIKE: { recovery: 50, easy: 55, endurance: 68, tempo: 80, sweetSpot: 88, threshold: 97, vo2: 108 },
  RUN: { recovery: 68, easy: 74, endurance: 78, tempo: 87, threshold: 98, fast: 104 },
  SWIM: { easy: 75, aerobic: 85, css: 100, fast: 105 },
};

/** Race-effort % of threshold by distance -- an Ironman bike is ~70% FTP, a sprint ~95%. */
const RACE_PACE: Record<RaceDistance, Record<TriDiscipline, number>> = {
  FULL: { SWIM: 88, BIKE: 72, RUN: 80 },
  HALF: { SWIM: 92, BIKE: 80, RUN: 86 },
  OLYMPIC: { SWIM: 96, BIKE: 90, RUN: 95 },
  SPRINT: { SWIM: 100, BIKE: 95, RUN: 100 },
};

const MIN = 60;

function step(discipline: TriDiscipline, label: string, durationSec: number, percent: number): WorkoutStep {
  return { label, durationSec, targetLow: percent, targetMode: "percent", targetUnit: UNIT[discipline] };
}

function steady(discipline: TriDiscipline, label: string, durationSec: number, percent: number): WorkoutStep[] {
  return durationSec > 0 ? [step(discipline, label, durationSec, percent)] : [];
}

interface IntervalSpec {
  warmUpSec: number;
  coolDownSec: number;
  onSec: number;
  offSec: number;
  onPct: number;
  offPct: number;
  maxReps: number;
  /** Intensity for whatever time is left once warm-up, reps and cool-down are placed. */
  fillPct: number;
  onLabel: string;
  /** Defaults to "Recover"; long-ride floats between blocks are endurance, not recovery. */
  offLabel?: string;
  /** Fewer reps than this and the session is just ridden/run steady instead. */
  minReps?: number;
}

/**
 * Warm-up, N x (on, off), steady filler, cool-down -- summing exactly to `totalSec`. Returns
 * null when the session is too short to fit `minReps` reps, so the caller can fall back to a
 * steady session instead of a token single interval.
 */
function intervals(discipline: TriDiscipline, totalSec: number, spec: IntervalSpec): WorkoutStep[] | null {
  const easy = discipline === "SWIM" ? ZONE.SWIM.easy : discipline === "BIKE" ? ZONE.BIKE.easy : ZONE.RUN.easy;
  const mainSec = totalSec - spec.warmUpSec - spec.coolDownSec;
  const reps = Math.min(spec.maxReps, Math.floor(mainSec / (spec.onSec + spec.offSec)));
  if (reps < (spec.minReps ?? 2)) return null;
  const fillSec = mainSec - reps * (spec.onSec + spec.offSec);
  return [
    step(discipline, "Warm-up", spec.warmUpSec, easy),
    {
      repeat: reps,
      steps: [
        step(discipline, spec.onLabel, spec.onSec, spec.onPct),
        step(discipline, spec.offLabel ?? "Recover", spec.offSec, spec.offPct),
      ],
    },
    ...steady(discipline, "Steady", fillSec, spec.fillPct),
    step(discipline, "Cool-down", spec.coolDownSec, easy),
  ];
}

function steadySession(discipline: TriDiscipline, totalSec: number, percent: number): WorkoutStep[] {
  const warmUpSec = Math.min(10 * MIN, Math.round(totalSec / 6 / MIN) * MIN);
  const coolDownSec = Math.min(5 * MIN, Math.round(totalSec / 12 / MIN) * MIN);
  const easy = discipline === "SWIM" ? ZONE.SWIM.easy : discipline === "BIKE" ? ZONE.BIKE.easy : ZONE.RUN.easy;
  return [
    ...steady(discipline, "Warm-up", warmUpSec, easy),
    step(discipline, "Steady", totalSec - warmUpSec - coolDownSec, percent),
    ...steady(discipline, "Cool-down", coolDownSec, easy),
  ];
}

function minutes(sec: number): string {
  return `${Math.round(sec / MIN)}′`;
}

function longRide(totalSec: number, ctx: SessionContext): SessionPlan {
  const race = RACE_PACE[ctx.distance].BIKE;
  const long = ctx.distance === "FULL" || ctx.distance === "HALF";
  const base: SessionPlan = {
    title: "Long ride",
    notes: "Aerobic endurance: keep it conversational the whole way. Practise race-day fuelling.",
    steps: steadySession("BIKE", totalSec, ZONE.BIKE.endurance),
  };
  if (ctx.recovery || ctx.phase === "BASE") return base;

  if (ctx.phase === "BUILD") {
    const on = long ? 20 * MIN : 12 * MIN;
    const pct = long ? ZONE.BIKE.tempo - 2 : ZONE.BIKE.sweetSpot;
    const steps = intervals("BIKE", totalSec, {
      warmUpSec: 15 * MIN, coolDownSec: 10 * MIN, onSec: on, offSec: 10 * MIN, onPct: pct,
      offPct: ZONE.BIKE.endurance, maxReps: 3, fillPct: ZONE.BIKE.endurance, onLabel: "Tempo", offLabel: "Endurance",
    });
    return steps
      ? { title: `Long ride · 3×${minutes(on)} tempo`, notes: "Endurance ride with tempo blocks to build muscular endurance.", steps }
      : base;
  }

  // PEAK and TAPER: race-specific blocks at goal race effort.
  const on = ctx.phase === "TAPER" ? 15 * MIN : long ? (ctx.distance === "FULL" ? 40 : 25) * MIN : 15 * MIN;
  const steps = intervals("BIKE", totalSec, {
    warmUpSec: 15 * MIN, coolDownSec: 10 * MIN, onSec: on, offSec: 10 * MIN, onPct: race,
    offPct: ZONE.BIKE.endurance, maxReps: ctx.phase === "TAPER" ? 2 : 3, fillPct: ZONE.BIKE.endurance,
    onLabel: "Race pace", offLabel: "Endurance",
  });
  return steps
    ? { title: `Long ride · race-pace ${minutes(on)} blocks`, notes: "Rehearse race effort and fuelling in the middle of a long day.", steps }
    : base;
}

function bikeQuality(totalSec: number, ctx: SessionContext): SessionPlan {
  const endurance: SessionPlan = {
    title: "Endurance ride",
    notes: "Steady aerobic riding.",
    steps: steadySession("BIKE", totalSec, ZONE.BIKE.endurance),
  };
  if (ctx.recovery) return { ...endurance, title: "Easy spin", notes: "Recovery week: keep it light.", steps: steadySession("BIKE", totalSec, ZONE.BIKE.easy + 5) };

  const short = ctx.distance === "OLYMPIC" || ctx.distance === "SPRINT";
  const variants: Record<Exclude<TrainingPhase, "RACE">, { title: string; notes: string; spec: IntervalSpec }> = {
    BASE: {
      title: "Sweet spot 3×10′",
      notes: "Just below threshold: raises FTP without much fatigue.",
      spec: { warmUpSec: 15 * MIN, coolDownSec: 10 * MIN, onSec: 10 * MIN, offSec: 5 * MIN, onPct: ZONE.BIKE.sweetSpot, offPct: ZONE.BIKE.easy, maxReps: 3, fillPct: ZONE.BIKE.endurance, onLabel: "Sweet spot" },
    },
    BUILD: {
      title: "Threshold 4×8′",
      notes: "Threshold intervals: hold power steady from first rep to last.",
      spec: { warmUpSec: 15 * MIN, coolDownSec: 10 * MIN, onSec: 8 * MIN, offSec: 4 * MIN, onPct: ZONE.BIKE.threshold, offPct: ZONE.BIKE.easy, maxReps: 4, fillPct: ZONE.BIKE.endurance, onLabel: "Threshold" },
    },
    PEAK: short
      ? {
          title: "VO2max 5×4′",
          notes: "Hard, short efforts for race-day top end.",
          spec: { warmUpSec: 15 * MIN, coolDownSec: 10 * MIN, onSec: 4 * MIN, offSec: 4 * MIN, onPct: ZONE.BIKE.vo2, offPct: ZONE.BIKE.easy, maxReps: 5, fillPct: ZONE.BIKE.endurance, onLabel: "VO2max" },
        }
      : {
          title: "Sweet spot 3×15′",
          notes: "Long sweet-spot efforts: race-specific strength.",
          spec: { warmUpSec: 15 * MIN, coolDownSec: 10 * MIN, onSec: 15 * MIN, offSec: 5 * MIN, onPct: ZONE.BIKE.sweetSpot, offPct: ZONE.BIKE.easy, maxReps: 3, fillPct: ZONE.BIKE.endurance, onLabel: "Sweet spot" },
        },
    TAPER: {
      title: "Threshold 3×5′",
      notes: "Taper: short and sharp to keep the legs awake.",
      spec: { warmUpSec: 15 * MIN, coolDownSec: 10 * MIN, onSec: 5 * MIN, offSec: 3 * MIN, onPct: ZONE.BIKE.threshold, offPct: ZONE.BIKE.easy, maxReps: 3, fillPct: ZONE.BIKE.endurance, onLabel: "Threshold" },
    },
  };
  const variant = variants[ctx.phase === "RACE" ? "TAPER" : ctx.phase];
  const steps = intervals("BIKE", totalSec, variant.spec);
  return steps ? { title: variant.title, notes: variant.notes, steps } : endurance;
}

function bikeEndurance(totalSec: number, ctx: SessionContext): SessionPlan {
  return {
    title: ctx.recovery ? "Easy spin" : "Endurance ride",
    notes: ctx.recovery ? "Recovery week: keep it light." : "Steady aerobic riding.",
    steps: steadySession("BIKE", totalSec, ctx.recovery ? ZONE.BIKE.easy + 5 : ZONE.BIKE.endurance),
  };
}

function longRun(totalSec: number, ctx: SessionContext): SessionPlan {
  const race = RACE_PACE[ctx.distance].RUN;
  const base: SessionPlan = {
    title: "Long run",
    notes: "Easy aerobic running; walk the aid stations if that's your race plan.",
    steps: steadySession("RUN", totalSec, ZONE.RUN.endurance),
  };
  if (ctx.recovery || ctx.phase === "BASE" || ctx.phase === "TAPER") return base;

  // Finish the last stretch at goal race pace, on tired legs.
  const finishSec = (ctx.phase === "PEAK" ? 25 : 15) * MIN;
  const warmUpSec = 10 * MIN;
  const coolDownSec = 5 * MIN;
  const steadySec = totalSec - warmUpSec - finishSec - coolDownSec;
  if (steadySec < 15 * MIN) return base;
  return {
    title: `Long run · ${minutes(finishSec)} at race pace`,
    notes: "Steady running with a race-pace finish.",
    steps: [
      step("RUN", "Warm-up", warmUpSec, ZONE.RUN.easy),
      step("RUN", "Steady", steadySec, ZONE.RUN.endurance),
      step("RUN", "Race pace", finishSec, race),
      step("RUN", "Cool-down", coolDownSec, ZONE.RUN.easy),
    ],
  };
}

function runQuality(totalSec: number, ctx: SessionContext): SessionPlan {
  const easy = runEasy(totalSec, ctx);
  if (ctx.recovery) return easy;

  const short = ctx.distance === "OLYMPIC" || ctx.distance === "SPRINT";
  const race = RACE_PACE[ctx.distance].RUN;
  const variants: Record<Exclude<TrainingPhase, "RACE">, { title: string; notes: string; spec: IntervalSpec }> = {
    BASE: {
      title: "Fartlek 6×1′",
      notes: "Relaxed fast running to keep leg speed through the base phase.",
      spec: { warmUpSec: 15 * MIN, coolDownSec: 5 * MIN, onSec: MIN, offSec: 2 * MIN, onPct: ZONE.RUN.threshold, offPct: ZONE.RUN.recovery, maxReps: 6, fillPct: ZONE.RUN.endurance, onLabel: "Fast" },
    },
    BUILD: {
      title: "Threshold 4×6′",
      notes: "Comfortably hard: controlled breathing, even splits.",
      spec: { warmUpSec: 15 * MIN, coolDownSec: 5 * MIN, onSec: 6 * MIN, offSec: 2 * MIN, onPct: ZONE.RUN.threshold, offPct: ZONE.RUN.recovery, maxReps: 4, fillPct: ZONE.RUN.endurance, onLabel: "Threshold" },
    },
    PEAK: short
      ? {
          title: "Intervals 5×3′",
          notes: "Faster than race pace so race pace feels controlled.",
          spec: { warmUpSec: 15 * MIN, coolDownSec: 5 * MIN, onSec: 3 * MIN, offSec: 2 * MIN, onPct: ZONE.RUN.fast, offPct: ZONE.RUN.recovery, maxReps: 5, fillPct: ZONE.RUN.endurance, onLabel: "Hard" },
        }
      : {
          title: "Race pace 3×10′",
          notes: "Lock in goal race pace.",
          spec: { warmUpSec: 15 * MIN, coolDownSec: 5 * MIN, onSec: 10 * MIN, offSec: 3 * MIN, onPct: Math.max(race + 5, ZONE.RUN.tempo), offPct: ZONE.RUN.recovery, maxReps: 3, fillPct: ZONE.RUN.endurance, onLabel: "Race pace" },
        },
    TAPER: {
      title: "Sharpener 4×3′",
      notes: "Taper: brief efforts, full recoveries.",
      spec: { warmUpSec: 15 * MIN, coolDownSec: 5 * MIN, onSec: 3 * MIN, offSec: 2 * MIN, onPct: ZONE.RUN.threshold, offPct: ZONE.RUN.recovery, maxReps: 4, fillPct: ZONE.RUN.endurance, onLabel: "Threshold" },
    },
  };
  const variant = variants[ctx.phase === "RACE" ? "TAPER" : ctx.phase];
  const steps = intervals("RUN", totalSec, variant.spec);
  return steps ? { title: variant.title, notes: variant.notes, steps } : easy;
}

function runEasy(totalSec: number, ctx: SessionContext): SessionPlan {
  return {
    title: "Easy run",
    notes: ctx.recovery ? "Recovery week: easy and short." : "Easy aerobic miles.",
    steps: [step("RUN", "Easy", totalSec, ctx.recovery ? ZONE.RUN.recovery + 4 : ZONE.RUN.easy)],
  };
}

function brickRun(totalSec: number, ctx: SessionContext): SessionPlan {
  return {
    title: "Brick run",
    notes: "Straight off the bike: find your race rhythm on heavy legs.",
    steps: [step("RUN", "Race pace", totalSec, RACE_PACE[ctx.distance].RUN)],
  };
}

function swim(kind: "SWIM_TECHNIQUE" | "SWIM_ENDURANCE" | "SWIM_QUALITY", totalSec: number, ctx: SessionContext): SessionPlan {
  const race = RACE_PACE[ctx.distance].SWIM;
  const aerobic: SessionPlan = {
    title: "Aerobic swim",
    notes: "Continuous aerobic swimming; focus on long, relaxed strokes.",
    steps: steadySession("SWIM", totalSec, ZONE.SWIM.aerobic),
  };

  if (kind === "SWIM_TECHNIQUE" || ctx.recovery) {
    const drillsSec = 10 * MIN;
    const steps = intervals("SWIM", totalSec - drillsSec, {
      warmUpSec: 10 * MIN, coolDownSec: 5 * MIN, onSec: 5 * MIN, offSec: MIN, onPct: ZONE.SWIM.aerobic,
      offPct: ZONE.SWIM.easy, maxReps: 6, fillPct: ZONE.SWIM.aerobic, onLabel: "Aerobic",
    });
    if (!steps) return aerobic;
    // Drills go straight after the warm-up.
    steps.splice(1, 0, step("SWIM", "Drills", drillsSec, ZONE.SWIM.easy));
    return { title: "Technique swim", notes: "Drills (catch, body position) then relaxed aerobic sets.", steps };
  }

  if (kind === "SWIM_ENDURANCE") {
    if (ctx.phase === "BASE") return aerobic;
    const steps = intervals("SWIM", totalSec, {
      warmUpSec: 10 * MIN, coolDownSec: 5 * MIN, onSec: 10 * MIN, offSec: MIN, onPct: race,
      offPct: ZONE.SWIM.easy, maxReps: 4, fillPct: ZONE.SWIM.aerobic, onLabel: "Race pace",
    });
    return steps ? { title: "Endurance swim · race pace", notes: "Long repeats at goal race effort.", steps } : aerobic;
  }

  const taper = ctx.phase === "TAPER" || ctx.phase === "RACE";
  const steps = intervals("SWIM", totalSec, {
    warmUpSec: 10 * MIN, coolDownSec: 5 * MIN, onSec: (taper ? 2 : 3) * MIN, offSec: taper ? MIN : 30,
    onPct: ZONE.SWIM.css, offPct: ZONE.SWIM.easy, maxReps: taper ? 6 : 10, fillPct: ZONE.SWIM.aerobic, onLabel: "CSS",
    minReps: 4,
  });
  return steps
    ? { title: "CSS intervals", notes: "Threshold swim pace (CSS) with short rests.", steps }
    : aerobic;
}

/** Race-week openers: short, with a few race-pace efforts to stay sharp without adding fatigue. */
function opener(kind: "SWIM_OPENER" | "BIKE_OPENER" | "RUN_OPENER", ctx: SessionContext): SessionPlan {
  const race = RACE_PACE[ctx.distance];
  if (kind === "SWIM_OPENER") {
    return {
      title: "Race-week swim",
      notes: "Loosen up with a few race-pace pickups.",
      steps: [
        step("SWIM", "Warm-up", 10 * MIN, ZONE.SWIM.easy),
        { repeat: 4, steps: [step("SWIM", "Race pace", MIN, race.SWIM), step("SWIM", "Easy", MIN, ZONE.SWIM.easy)] },
        step("SWIM", "Cool-down", 7 * MIN, ZONE.SWIM.easy),
      ],
    };
  }
  if (kind === "BIKE_OPENER") {
    return {
      title: "Race-week ride",
      notes: "Openers: check the bike and remind the legs of race effort.",
      steps: [
        step("BIKE", "Warm-up", 15 * MIN, ZONE.BIKE.easy),
        { repeat: 3, steps: [step("BIKE", "Race pace", 3 * MIN, race.BIKE + 5), step("BIKE", "Easy", 3 * MIN, ZONE.BIKE.easy)] },
        step("BIKE", "Cool-down", 12 * MIN, ZONE.BIKE.easy),
      ],
    };
  }
  return {
    title: "Race-week run",
    notes: "Short and easy with strides.",
    steps: [
      step("RUN", "Easy", 12 * MIN, ZONE.RUN.easy),
      { repeat: 4, steps: [step("RUN", "Stride", 30, ZONE.RUN.fast), step("RUN", "Walk/jog", 90, ZONE.RUN.recovery)] },
      step("RUN", "Easy", 5 * MIN, ZONE.RUN.easy),
    ],
  };
}

export function buildSession(kind: SessionKind, totalSec: number, ctx: SessionContext): SessionPlan {
  switch (kind) {
    case "LONG_RIDE":
      return longRide(totalSec, ctx);
    case "BIKE_QUALITY":
      return bikeQuality(totalSec, ctx);
    case "BIKE_ENDURANCE":
      return bikeEndurance(totalSec, ctx);
    case "LONG_RUN":
      return longRun(totalSec, ctx);
    case "RUN_QUALITY":
      return runQuality(totalSec, ctx);
    case "RUN_EASY":
      return runEasy(totalSec, ctx);
    case "BRICK_RUN":
      return brickRun(totalSec, ctx);
    case "SWIM_TECHNIQUE":
    case "SWIM_ENDURANCE":
    case "SWIM_QUALITY":
      return swim(kind, totalSec, ctx);
    case "SWIM_OPENER":
    case "BIKE_OPENER":
    case "RUN_OPENER":
      return opener(kind, ctx);
  }
}
