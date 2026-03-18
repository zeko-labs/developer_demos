import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["mock-server/tests/**/*.spec.ts"],
    environment: "node",
    coverage: {
      reporter: ["text"],
    },
  },
});
