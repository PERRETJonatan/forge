import { describe, expect, it } from "vitest";
import { CsvParseError, parseCsv } from "../../src/plan-imports/parsers/csv.parser.js";

describe("parseCsv", () => {
  it("parses rows using flexible header aliases", () => {
    const csv = [
      "Date,WorkoutType,Title,Description,Duration (h),Distance (km),Intensity",
      "2026-09-20,Run,Easy Run,Zone 2 easy run,0:45,8,Zone 2",
      "2026-09-22,Bike,Threshold Ride,Sweet spot intervals,1:30,,Zone 3-4",
    ].join("\n");

    const workouts = parseCsv(Buffer.from(csv));
    expect(workouts).toHaveLength(2);

    expect(workouts[0]).toMatchObject({
      date: "2026-09-20",
      discipline: "RUN",
      title: "Easy Run",
      notes: "Zone 2 easy run",
      targetDurationSec: 45 * 60,
      targetDistanceM: 8000,
      targetIntensity: "Zone 2",
    });

    expect(workouts[1]).toMatchObject({
      date: "2026-09-22",
      discipline: "BIKE",
      title: "Threshold Ride",
      targetDurationSec: 90 * 60,
    });
  });

  it("throws a clear error when no date column can be found", () => {
    const csv = ["Title,Notes", "Easy Run,Zone 2"].join("\n");
    expect(() => parseCsv(Buffer.from(csv))).toThrow(CsvParseError);
  });

  it("skips rows with an unparseable date", () => {
    const csv = ["Date,Title", "not-a-date,Easy Run", "2026-09-20,Real Run"].join("\n");
    const workouts = parseCsv(Buffer.from(csv));
    expect(workouts).toHaveLength(1);
    expect(workouts[0].title).toBe("Real Run");
  });
});
