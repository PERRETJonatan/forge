import { describe, expect, it } from "vitest";
import { parseIcs } from "../../src/plan-imports/parsers/ics.parser.js";

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:test-1@example.com
DTSTAMP:20260901T000000Z
DTSTART:20260920T100000Z
DTEND:20260920T110000Z
SUMMARY:Easy Run
DESCRIPTION:Zone 2 easy run
END:VEVENT
BEGIN:VEVENT
UID:test-2@example.com
DTSTAMP:20260901T000000Z
DTSTART;VALUE=DATE:20260921
SUMMARY:Bike spin
END:VEVENT
END:VCALENDAR
`;

describe("parseIcs", () => {
  it("parses timed events into a workout with a duration", () => {
    const workouts = parseIcs(Buffer.from(ICS));
    const run = workouts.find((w) => w.title === "Easy Run");
    expect(run).toBeDefined();
    expect(run!.date).toBe("2026-09-20");
    expect(run!.discipline).toBe("RUN");
    expect(run!.notes).toBe("Zone 2 easy run");
    expect(run!.targetDurationSec).toBe(3600);
  });

  it("parses full-day (DATE-only) events using the UTC date", () => {
    const workouts = parseIcs(Buffer.from(ICS));
    const bike = workouts.find((w) => w.title === "Bike spin");
    expect(bike).toBeDefined();
    expect(bike!.date).toBe("2026-09-21");
    expect(bike!.discipline).toBe("BIKE");
  });
});
