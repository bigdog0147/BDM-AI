import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      OPENAI_API_KEY: "test-key-not-a-real-secret",
      OPENAI_MODEL: "gpt-5.6-luna",
      BDM_WEB_SEARCH_ENABLED: "false"
    }
  }
});
