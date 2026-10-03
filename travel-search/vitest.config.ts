import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { TRAVEL_PROVIDERS: "mock", TRAVEL_STORE: "memory" },
  },
});
