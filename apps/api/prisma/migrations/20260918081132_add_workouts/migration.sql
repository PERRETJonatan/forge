-- CreateEnum
CREATE TYPE "Discipline" AS ENUM ('SWIM', 'BIKE', 'RUN', 'STRENGTH', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkoutSource" AS ENUM ('MANUAL', 'IMPORT', 'STRAVA', 'COACH_DRAFT');

-- CreateTable
CREATE TABLE "workouts" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "source" "WorkoutSource" NOT NULL DEFAULT 'MANUAL',
    "title" TEXT,
    "notes" TEXT,
    "targetDurationSec" INTEGER,
    "targetDistanceM" DOUBLE PRECISION,
    "targetIntensity" TEXT,
    "actualDurationSec" INTEGER,
    "actualDistanceM" DOUBLE PRECISION,
    "actualIntensity" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workouts_athleteId_date_idx" ON "workouts"("athleteId", "date");

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "athletes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
