// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // Netlify discovers functions at the repository root.
  nitro:
    process.env["NETLIFY"] === "true" || process.env["NITRO_PRESET"] === "netlify"
      ? {
          preset: "netlify",
          output: { dir: resolve(import.meta.dirname, "../.netlify/functions-internal") },
        }
      : undefined,
  vite: {
    plugins: [
      {
        name: "clarity-backend-env",
        configResolved(config) {
          const env = loadEnv(config.mode, config.envDir, "CLARITY_BACKEND_");
          if (!process.env["CLARITY_BACKEND_URL"] && env["CLARITY_BACKEND_URL"]) {
            process.env["CLARITY_BACKEND_URL"] = env["CLARITY_BACKEND_URL"];
          }
        },
      },
    ],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
