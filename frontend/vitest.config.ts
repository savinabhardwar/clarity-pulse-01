// Deliberately separate from vite.config.ts: that one is the Lovable/TanStack
// Start/Nitro app config, and none of those plugins belong in a unit-test run.
// Tests here cover pure logic in src/lib, so a plain node environment and the
// `@` alias (same as the app's) are all that's needed.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
