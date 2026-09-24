-- AlterTable
ALTER TABLE "athletes" ADD COLUMN     "calendarFeedToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "athletes_calendarFeedToken_key" ON "athletes"("calendarFeedToken");
