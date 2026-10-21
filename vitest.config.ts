import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 15000,
    env: {
      OPENAI_API_KEY: "test-key-not-a-real-secret",
      OPENAI_MODEL: "gpt-5.6-luna",
      BDM_WEB_SEARCH_ENABLED: "false",
      // Local Supabase stack (started via `supabase start`). The auth/persistence
      // suite auto-skips when this URL is unreachable, so CI without Docker passes.
      SUPABASE_LOCAL_URL: "http://127.0.0.1:54321",
      SUPABASE_LOCAL_PUBLISHABLE_KEY: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
      BDM_SUPABASE_TESTS: process.env.BDM_SUPABASE_TESTS ?? ""
    }
  }
});
