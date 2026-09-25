-- CreateTable
CREATE TABLE "strava_connections" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "stravaAthleteId" BIGINT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strava_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strava_activities" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "stravaActivityId" BIGINT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "name" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "distanceM" DOUBLE PRECISION,
    "elevationGainM" DOUBLE PRECISION,
    "avgWatts" DOUBLE PRECISION,
    "avgHr" DOUBLE PRECISION,
    "avgSpeedMps" DOUBLE PRECISION,
    "matchedWorkoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strava_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "strava_connections_athleteId_key" ON "strava_connections"("athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "strava_activities_stravaActivityId_key" ON "strava_activities"("stravaActivityId");

-- CreateIndex
CREATE UNIQUE INDEX "strava_activities_matchedWorkoutId_key" ON "strava_activities"("matchedWorkoutId");

-- CreateIndex
CREATE INDEX "strava_activities_athleteId_startDate_idx" ON "strava_activities"("athleteId", "startDate");

-- AddForeignKey
ALTER TABLE "strava_connections" ADD CONSTRAINT "strava_connections_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "athletes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strava_activities" ADD CONSTRAINT "strava_activities_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "athletes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strava_activities" ADD CONSTRAINT "strava_activities_matchedWorkoutId_fkey" FOREIGN KEY ("matchedWorkoutId") REFERENCES "workouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
