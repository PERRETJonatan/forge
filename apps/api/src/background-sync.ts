import { syncStaleFeeds as syncStaleRunnaFeeds } from "./runna/runna.service.js";
import { syncStaleConnections as syncStaleStravaConnections } from "./strava/strava.service.js";

/** How often to look for stale connections; each service decides what "stale" means. */
const CHECK_EVERY_MS = 10 * 60 * 1000;

/**
 * Keeps synced data fresh without anyone pressing "Sync now": Strava activities within ~30
 * minutes of upload, the Runna plan every few hours. Runs in the API process (started from
 * index.ts, not from the app, so tests never trigger it); a pass is skipped while the previous
 * one is still going.
 */
export function startBackgroundSync(): NodeJS.Timeout {
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      await syncStaleStravaConnections();
      await syncStaleRunnaFeeds();
    } catch (err) {
      console.error("Background sync pass failed:", err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void pass(), CHECK_EVERY_MS);
  timer.unref();
  void pass();
  return timer;
}
