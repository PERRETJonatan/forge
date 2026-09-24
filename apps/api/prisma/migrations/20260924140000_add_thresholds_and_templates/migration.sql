-- AlterTable
ALTER TABLE "athletes" ADD COLUMN     "ftpWatts" INTEGER,
ADD COLUMN     "runThresholdPaceSecPerKm" INTEGER,
ADD COLUMN     "swimThresholdPaceSec100m" INTEGER,
ADD COLUMN     "thresholdHr" INTEGER;

-- CreateTable
CREATE TABLE "workout_templates" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "steps" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workout_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workout_templates_athleteId_idx" ON "workout_templates"("athleteId");

-- AddForeignKey
ALTER TABLE "workout_templates" ADD CONSTRAINT "workout_templates_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "athletes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
