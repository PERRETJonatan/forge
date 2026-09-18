import { describe, expect, it } from "vitest";
import { parseTcx } from "../../src/plan-imports/parsers/tcx.parser.js";

const TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Workouts>
    <Workout Sport="Running">
      <Name>Threshold Run</Name>
      <Step xsi:type="Step_t">
        <StepId>1</StepId>
        <Name>Warm up</Name>
        <Duration xsi:type="Time_t"><Seconds>600</Seconds></Duration>
        <Intensity>Warmup</Intensity>
        <Target xsi:type="None_t"/>
      </Step>
      <Step xsi:type="Repeat_t">
        <StepId>2</StepId>
        <Repetitions>4</Repetitions>
        <Child xsi:type="Step_t">
          <StepId>3</StepId>
          <Duration xsi:type="Time_t"><Seconds>240</Seconds></Duration>
          <Intensity>Active</Intensity>
          <Target xsi:type="Speed_t">
            <SpeedZone>
              <LowInMetersPerSecond>3.5</LowInMetersPerSecond>
              <HighInMetersPerSecond>3.8</HighInMetersPerSecond>
            </SpeedZone>
          </Target>
        </Child>
        <Child xsi:type="Step_t">
          <StepId>4</StepId>
          <Duration xsi:type="Time_t"><Seconds>120</Seconds></Duration>
          <Intensity>Rest</Intensity>
          <Target xsi:type="None_t"/>
        </Child>
      </Step>
    </Workout>
  </Workouts>
</TrainingCenterDatabase>
`;

describe("parseTcx", () => {
  it("parses a workout with a leaf step and a nested repeat group", () => {
    const workouts = parseTcx(Buffer.from(TCX));
    expect(workouts).toHaveLength(1);

    const workout = workouts[0];
    expect(workout.discipline).toBe("RUN");
    expect(workout.title).toBe("Threshold Run");

    const steps = workout.structuredIntervals!;
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ label: "Warm up", durationSec: 600 });

    const repeatGroup = steps[1];
    expect(repeatGroup.repeat).toBe(4);
    expect(repeatGroup.steps).toHaveLength(2);
    expect(repeatGroup.steps![0]).toMatchObject({
      durationSec: 240,
      targetLow: 3.5,
      targetHigh: 3.8,
      targetUnit: "speed_m_s",
    });
    expect(repeatGroup.steps![1]).toMatchObject({ durationSec: 120 });
  });
});
