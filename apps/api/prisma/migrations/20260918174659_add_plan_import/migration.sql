-- CreateEnum
CREATE TYPE "PlanFormat" AS ENUM ('TRAININGPEAKS_CSV', 'ICS', 'FIT', 'TCX');

-- AlterTable
ALTER TABLE "workouts" ADD COLUMN     "planImportId" TEXT,
ADD COLUMN     "structuredIntervals" JSONB;

-- CreateTable
CREATE TABLE "plan_imports" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "format" "PlanFormat" NOT NULL,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_imports_athleteId_importedAt_idx" ON "plan_imports"("athleteId", "importedAt");

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_planImportId_fkey" FOREIGN KEY ("planImportId") REFERENCES "plan_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_imports" ADD CONSTRAINT "plan_imports_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "athletes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
