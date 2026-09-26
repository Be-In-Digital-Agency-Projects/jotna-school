import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
    // `apps/**` est exclu parce que ce runner-ci tourne en `jsdom` avec
    // l'alias `@` du web : il ramasserait les tests d'`apps/mobile`, qui
    // n'ont ni le même environnement ni les mêmes alias. Le mobile a son
    // propre runner.
    exclude: ["**/node_modules/**", "**/e2e/**", "**/.next/**", "**/apps/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
