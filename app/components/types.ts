export type AuthUser = {
  id: string;
  email?: string | null;
  providers?: string[];
} | null;

export type Source = {
  index: number;
  title: string;
  url: string;
  domain: string;
  publishedDate?: string | null;
  snippet?: string;
};

export type CapabilityStatus = {
  signedIn: boolean;
  memory: { available: boolean };
  ai: {
    provider: string;
    model: string | null;
    configured: boolean;
    fallback?: { provider: string | null; configured: boolean };
  };
  search: { provider: string | null; configured: boolean };
  images: {
    provider: string | null;
    model: string | null;
    configured: boolean;
  };
  voice: {
    provider: string | null;
    model: string | null;
    configured: boolean;
    retention: string;
    maxDurationSeconds: number;
  };
  email?: {
    provider: string | null;
    configured: boolean;
    enabled: boolean;
    apiKeyConfigured?: boolean;
    fromConfigured?: boolean;
    webhook?: { configured: boolean; storage: string };
  };
  google?: {
    configured: boolean;
    credentialsConfigured: boolean;
    identityStoreConfigured: boolean;
    callbackUrl: string;
    origin?: string;
    linked: boolean;
    providers: string[];
  };
  quotas?: {
    store: "database" | "not_configured";
    migration: string;
    migrationState: string;
    limits: Record<string, number>;
  };
  /**
   * Environment diagnostics: variable names and whether a value is present.
   * A value is never included.
   */
  environment?: {
    name: string;
    present: boolean;
    purpose: string;
    kind: "required" | "optional" | "alternative";
    group:
      | "AI"
      | "Research"
      | "Voice"
      | "Images"
      | "Auth"
      | "Google"
      | "Email"
      | "Storage";
  }[];
};

export type ConversationSummary = {
  id: string;
  title: string | null;
  updated_at: string;
};

export type MessageMemoryAction = {
  type: "saved" | "forgotten" | "blocked_secret" | "unavailable" | "not_found";
  count?: number;
  contents?: string[];
  memory?: { id: string; content: string; kind: string };
};

export type MemoryUsed = { id: string; content: string; kind: string };
