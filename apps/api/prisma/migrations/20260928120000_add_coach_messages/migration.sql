-- CreateEnum
CREATE TYPE "CoachRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "coach_messages" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "role" "CoachRole" NOT NULL,
    "content" TEXT NOT NULL,
    "draft" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coach_messages_athleteId_createdAt_idx" ON "coach_messages"("athleteId", "createdAt");

-- AddForeignKey
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "athletes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
