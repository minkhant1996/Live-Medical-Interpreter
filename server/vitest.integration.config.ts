import { defineConfig } from "vitest/config";
import { config } from "dotenv";

// Load .env file for integration tests
config();

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/integration/**/*.test.ts"],
    testTimeout: 120000, // 2 min timeout for LLM calls
    hookTimeout: 30000,
    setupFiles: ["dotenv/config"],
  },
});
