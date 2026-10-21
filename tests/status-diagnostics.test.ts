import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { GET as statusGet } from "../app/api/status/route";
import {
  environmentStatus,
  missingRequired
} from "../lib/diagnostics";

/**
 * Diagnostics tests.
 *
 * The environment report exists so an operator can see which variables are
 * missing without ever seeing a value. These tests hold that line: a secret
 * set in the environment must not appear anywhere in the response.
 */

const ENV_KEYS = [
  "AI_PROVIDER",
  "OLLAMA_API_KEY",
  "OLLAMA_API_MODEL",
  "OLLAMA_API_HOST",
  "OLLAMA_HOST",
  "OLLAMA_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "BDM_SEARCH_PROVIDER",
  "TAVILY_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "SEARXNG_URL",
  "BDM_TRANSCRIBE_MODEL",
  "BDM_IMAGE_MODEL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "BDM_EMAIL_ENABLED",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "RESEND_WEBHOOK_SECRET"
] as const;

let originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("environment diagnostics", () => {
  it("reports names and presence, never values", () => {
    process.env.TAVILY_API_KEY = "tvly-super-secret-value";

    const status = environmentStatus();
    const tavily = status.find((item) => item.name === "TAVILY_API_KEY");

    expect(tavily).toBeTruthy();
    expect(tavily?.present).toBe(true);
    expect(JSON.stringify(status)).not.toContain("tvly-super-secret-value");
  });

  it("marks an unset variable as not present", () => {
    const status = environmentStatus();
    expect(status.find((item) => item.name === "TAVILY_API_KEY")?.present).toBe(
      false
    );
  });

  it("treats an empty string as not present", () => {
    process.env.TAVILY_API_KEY = "   ";
    const status = environmentStatus();
    expect(status.find((item) => item.name === "TAVILY_API_KEY")?.present).toBe(
      false
    );
  });

  it("lists the required variables that are missing", () => {
    expect(missingRequired()).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(missingRequired()).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    process.env.AI_PROVIDER = "ollama";
    expect(missingRequired()).toEqual([]);
  });

  it("describes every variable it lists", () => {
    for (const item of environmentStatus()) {
      expect(item.purpose.length).toBeGreaterThan(10);
      expect(["required", "optional", "alternative"]).toContain(item.kind);
    }
  });
});

describe("GET /api/status", () => {
  it("exposes the environment report with names only", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    process.env.GOOGLE_CLIENT_ID = "client-id-value";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret-value";
    process.env.TAVILY_API_KEY = "tvly-super-secret-value";

    const response = await statusGet(
      new Request("https://bdm-ai.onrender.com/api/status")
    );
    const body = (await response.json()) as {
      environment?: { name: string; present: boolean }[];
      google?: { callbackUrl: string; origin?: string };
    };

    expect(response.status).toBe(200);
    expect(Array.isArray(body.environment)).toBe(true);

    const google = body.environment?.find(
      (item) => item.name === "GOOGLE_CLIENT_ID"
    );
    expect(google?.present).toBe(true);

    const text = JSON.stringify(body);
    expect(text).not.toContain("client-secret-value");
    expect(text).not.toContain("tvly-super-secret-value");
    expect(text).not.toContain("sb_publishable_x");
  });

  it("reports the exact Google callback and origin for this deployment", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";

    const response = await statusGet(
      new Request("https://bdm-ai.onrender.com/api/status")
    );
    const body = (await response.json()) as {
      google?: { callbackUrl: string; origin?: string };
    };

    expect(body.google?.callbackUrl).toBe(
      "https://bdm-ai.onrender.com/auth/callback/google"
    );
    expect(body.google?.origin).toBe("https://bdm-ai.onrender.com");
  });

  it("reports a missing Google configuration honestly", async () => {
    const response = await statusGet(
      new Request("https://bdm-ai.onrender.com/api/status")
    );
    const body = (await response.json()) as {
      google?: {
        configured: boolean;
        credentialsConfigured: boolean;
        identityStoreConfigured: boolean;
      };
    };

    expect(body.google?.credentialsConfigured).toBe(false);
    expect(body.google?.identityStoreConfigured).toBe(false);
    expect(body.google?.configured).toBe(false);
  });
});
