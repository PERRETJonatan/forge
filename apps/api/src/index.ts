import { createApp } from "./app.js";
import { env } from "./env.js";
import { startBackgroundSync } from "./background-sync.js";

const app = createApp();

app.listen(env.port, () => {
  console.log(`Forge API listening on port ${env.port}`);
});

startBackgroundSync();
