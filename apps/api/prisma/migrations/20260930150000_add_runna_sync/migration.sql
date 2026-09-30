-- AlterEnum
ALTER TYPE "WorkoutSource" ADD VALUE 'RUNNA';

-- AlterTable
ALTER TABLE "athletes" ADD COLUMN     "runnaFeedUrl" TEXT,
ADD COLUMN     "runnaLastSyncAt" TIMESTAMP(3),
ADD COLUMN     "runnaLastSyncError" TEXT;

-- AlterTable
ALTER TABLE "workouts" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "workouts_athleteId_externalId_key" ON "workouts"("athleteId", "externalId");
