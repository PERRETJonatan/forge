import { Encoder, Profile } from "@garmin/fitsdk";
import { describe, expect, it } from "vitest";
import { FitParseError, parseFit } from "../../src/plan-imports/parsers/fit.parser.js";

/**
 * Builds a real FIT workout file: warm-up, then 3x(work, rest), encoded
 * with the official SDK so the parser is exercised against actual FIT
 * bytes rather than a hand-rolled fixture.
 */
function buildWorkoutFit(): Buffer {
  const encoder = new Encoder();

  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    manufacturer: "development",
    product: 1,
    timeCreated: new Date(),
    type: "workout",
  });

  encoder.onMesg(Profile.MesgNum.WORKOUT, {
    sport: "running",
    wktName: "Test Workout",
    wktDescription: "A test workout",
    numValidSteps: 4,
  });

  encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, {
    messageIndex: 0,
    wktStepName: "Warm up",
    durationType: "time",
    durationValue: 300000, // scale 1000 -> ms; decodes to 300s
    targetType: "open",
  });

  encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, {
    messageIndex: 1,
    durationType: "time",
    durationValue: 240000,
    targetType: "power",
    customTargetValueLow: 250,
    customTargetValueHigh: 270,
  });

  encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, {
    messageIndex: 2,
    durationType: "time",
    durationValue: 120000,
    targetType: "open",
  });

  // Loop back to messageIndex 1, repeat 3 times.
  encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, {
    messageIndex: 3,
    durationType: "repeatUntilStepsCmplt",
    durationValue: 1,
    targetValue: 3,
    targetType: "open",
  });

  return Buffer.from(encoder.close());
}

describe("parseFit", () => {
  it("parses workout metadata and reconstructs a repeat group", () => {
    const [workout] = parseFit(buildWorkoutFit());

    expect(workout.discipline).toBe("RUN");
    expect(workout.title).toBe("Test Workout");
    expect(workout.notes).toBe("A test workout");
    expect(workout.date).toBeUndefined();

    const steps = workout.structuredIntervals!;
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ label: "Warm up", durationSec: 300 });

    const repeatGroup = steps[1];
    expect(repeatGroup.repeat).toBe(3);
    expect(repeatGroup.steps).toHaveLength(2);
    expect(repeatGroup.steps![0]).toMatchObject({
      durationSec: 240,
      targetLow: 250,
      targetHigh: 270,
      targetUnit: "power",
    });
    expect(repeatGroup.steps![1]).toMatchObject({ durationSec: 120 });
  });

  it("rejects a non-FIT file", () => {
    expect(() => parseFit(Buffer.from("not a fit file"))).toThrow(FitParseError);
  });
});
