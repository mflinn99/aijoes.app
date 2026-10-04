import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests never reach a real network, mailbox or model.
    env: { HIJOJO_SEND_MODE: "simulate", HIJOJO_DISABLE_WORKER: "1" },
  },
});
