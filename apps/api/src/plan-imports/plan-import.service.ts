import type { Prisma, PlanFormat, PlanImport } from "@prisma/client";
import { prisma } from "../db.js";
import { toDate } from "../workouts/workout.service.js";
import type { ParsedWorkout } from "./parsed-workout.js";
import { parseCsv } from "./parsers/csv.parser.js";
import { parseFit } from "./parsers/fit.parser.js";
import { parseIcs } from "./parsers/ics.parser.js";
import { parseTcx } from "./parsers/tcx.parser.js";

export class PlanImportError extends Error {
  constructor(
    message: string,
    public status: number = 400,
  ) {
    super(message);
  }
}

export interface ImportOptions {
  date?: string;
}

function detectFormat(filename: string): PlanFormat | undefined {
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "csv":
      return "TRAININGPEAKS_CSV";
    case "ics":
      return "ICS";
    case "fit":
      return "FIT";
    case "tcx":
      return "TCX";
    default:
      return undefined;
  }
}

function parseByFormat(format: PlanFormat, buffer: Buffer): ParsedWorkout[] {
  switch (format) {
    case "TRAININGPEAKS_CSV":
      return parseCsv(buffer);
    case "ICS":
      return parseIcs(buffer);
    case "FIT":
      return parseFit(buffer);
    case "TCX":
      return parseTcx(buffer);
  }
}

export async function importPlan(
  athleteId: string,
  filename: string,
  buffer: Buffer,
  options: ImportOptions,
): Promise<PlanImport> {
  const format = detectFormat(filename);
  if (!format) {
    throw new PlanImportError("Unsupported file type. Expected .csv, .ics, .fit, or .tcx.");
  }

  let parsed: ParsedWorkout[];
  try {
    parsed = parseByFormat(format, buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse file";
    throw new PlanImportError(`Could not parse ${filename} as ${format}: ${message}`);
  }

  const planImport = await prisma.planImport.create({
    data: { athleteId, filename, format },
  });

  const warnings: string[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const seenKeys = new Set<string>();

  for (const entry of parsed) {
    const date = entry.date ?? options.date;
    if (!date) {
      skipped++;
      warnings.push(
        `Skipped "${entry.title ?? entry.discipline}": this file doesn't carry a date — provide one when importing.`,
      );
      continue;
    }

    const key = `${date}|${entry.discipline}`;
    if (seenKeys.has(key)) {
      warnings.push(`Multiple ${entry.discipline} workouts on ${date} in this file — only the last one was kept.`);
    }
    seenKeys.add(key);

    const parsedDate = toDate(date);
    const existing = await prisma.workout.findFirst({
      where: { athleteId, source: "IMPORT", date: parsedDate, discipline: entry.discipline },
    });

    const data = {
      discipline: entry.discipline,
      date: parsedDate,
      source: "IMPORT" as const,
      title: entry.title ?? null,
      notes: entry.notes ?? null,
      targetDurationSec: entry.targetDurationSec ?? null,
      targetDistanceM: entry.targetDistanceM ?? null,
      targetIntensity: entry.targetIntensity ?? null,
      structuredIntervals: (entry.structuredIntervals ?? undefined) as Prisma.InputJsonValue | undefined,
      planImportId: planImport.id,
    };

    if (existing) {
      await prisma.workout.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.workout.create({ data: { ...data, athleteId } });
      created++;
    }
  }

  return prisma.planImport.update({
    where: { id: planImport.id },
    data: { createdCount: created, updatedCount: updated, skippedCount: skipped, warnings },
  });
}
