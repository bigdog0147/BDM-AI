/**
 * Client-side shapes for the redacted status endpoints.
 *
 * `/api/status` and `/api/auth/providers` only ever return provider names,
 * model names, booleans and limits - never a key, token or URL that carries
 * a credential.
 */

export type AppStatus = {
  signedIn: boolean;
  memory: { available: boolean };
  ai: {
    provider: string;
    model: string | null;
    configured: boolean;
    fallback?: { provider: string | null; configured: boolean };
  };
  search: { provider: string | null; configured: boolean };
  images: { provider: string | null; model: string | null; configured: boolean };
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
  };
  google?: {
    configured: boolean;
    credentialsConfigured: boolean;
    identityStoreConfigured: boolean;
    callbackUrl: string;
    linked: boolean;
    providers: string[];
  };
};

export type ProvidersStatus = {
  supabaseConfigured: boolean;
  google: {
    available: boolean;
    checked: boolean;
    reason: string | null;
  };
};

export type HealthStatus = {
  ok: boolean;
  service: string;
  version: string;
  time: string;
};

export type ConversationSummary = {
  id: string;
  title: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};
