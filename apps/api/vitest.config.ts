import { defineConfig } from "vitest/config";

export default defineConfig({
  // Run @forge/shared from its TypeScript source, same as `npm run dev` (see packages/shared/package.json).
  resolve: { conditions: ["@forge/source"] },
  ssr: { resolve: { conditions: ["@forge/source"] } },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
  },
});
