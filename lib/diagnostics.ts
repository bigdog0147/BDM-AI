/**
 * Environment diagnostics.
 *
 * This module reports the NAME of every environment variable the application
 * reads and whether a value is present. It never reads a value into the
 * response: the booleans below are the whole contract, so a diagnostics page
 * can be rendered from this without any risk of leaking a secret.
 */

export type EnvPurpose = "required" | "optional" | "alternative";

export interface EnvVarStatus {
  /** The exact variable name to set in the deployment environment. */
  name: string;
  /** True when a non-empty value is present. The value is never exposed. */
  present: boolean;
  /** What the variable is for, in plain language. */
  purpose: string;
  /** Which kind of variable this is. */
  kind: EnvPurpose;
  /** Grouping used by the Settings page. */
  group: "AI" | "Research" | "Voice" | "Images" | "Auth" | "Google" | "Email" | "Storage";
}

interface EnvDefinition {
  name: string;
  purpose: string;
  kind: EnvPurpose;
  group: EnvVarStatus["group"];
}

const DEFINITIONS: EnvDefinition[] = [
  {
    name: "AI_PROVIDER",
    purpose: "Which assistant provider answers chat: ollama or openai.",
    kind: "required",
    group: "AI"
  },
  {
    name: "OLLAMA_API_KEY",
    purpose: "Ollama Cloud key. Required on Render, where a local Ollama cannot be reached.",
    kind: "alternative",
    group: "AI"
  },
  {
    name: "OLLAMA_API_MODEL",
    purpose: "The Ollama Cloud model to use, for example gemma4:31b.",
    kind: "alternative",
    group: "AI"
  },
  {
    name: "OLLAMA_API_HOST",
    purpose: "Ollama Cloud host. Optional; defaults to https://ollama.com.",
    kind: "optional",
    group: "AI"
  },
  {
    name: "OLLAMA_HOST",
    purpose: "Local Ollama host. Development only.",
    kind: "alternative",
    group: "AI"
  },
  {
    name: "OLLAMA_MODEL",
    purpose: "Local Ollama model. Development only.",
    kind: "alternative",
    group: "AI"
  },
  {
    name: "OPENAI_API_KEY",
    purpose: "OpenAI key. Used for chat when selected, and for images and voice transcription.",
    kind: "optional",
    group: "AI"
  },
  {
    name: "OPENAI_MODEL",
    purpose: "The OpenAI model used for chat.",
    kind: "optional",
    group: "AI"
  },
  {
    name: "BDM_SEARCH_PROVIDER",
    purpose: "Pins the search provider: brave, tavily or searxng. Auto-detected when empty.",
    kind: "optional",
    group: "Research"
  },
  {
    name: "TAVILY_API_KEY",
    purpose: "Tavily search key. One search provider key is enough.",
    kind: "alternative",
    group: "Research"
  },
  {
    name: "BRAVE_SEARCH_API_KEY",
    purpose: "Brave Search key. One search provider key is enough.",
    kind: "alternative",
    group: "Research"
  },
  {
    name: "SEARXNG_URL",
    purpose: "Base URL of a self-hosted SearXNG instance with the JSON API enabled.",
    kind: "alternative",
    group: "Research"
  },
  {
    name: "BDM_TRANSCRIBE_MODEL",
    purpose: "Voice transcription model. Defaults to gpt-transcribe.",
    kind: "optional",
    group: "Voice"
  },
  {
    name: "BDM_IMAGE_MODEL",
    purpose: "Image generation model. Defaults to gpt-image-1.",
    kind: "optional",
    group: "Images"
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    purpose: "Supabase project URL. Required for accounts, history and memory.",
    kind: "required",
    group: "Auth"
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    purpose: "Supabase publishable key used by the browser client.",
    kind: "required",
    group: "Auth"
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    purpose: "Server-only key. Required for the Google linking guard and durable quotas.",
    kind: "optional",
    group: "Auth"
  },
  {
    name: "GOOGLE_CLIENT_ID",
    purpose: "Google OAuth client ID. Required for Continue with Google.",
    kind: "optional",
    group: "Google"
  },
  {
    name: "GOOGLE_CLIENT_SECRET",
    purpose: "Google OAuth client secret. Never reaches the browser.",
    kind: "optional",
    group: "Google"
  },
  {
    name: "GOOGLE_REDIRECT_URI",
    purpose: "Exact authorized redirect URI. Derived from the request when empty.",
    kind: "optional",
    group: "Google"
  },
  {
    name: "BDM_EMAIL_ENABLED",
    purpose: "Must be exactly true before any email is sent.",
    kind: "optional",
    group: "Email"
  },
  {
    name: "RESEND_API_KEY",
    purpose: "Resend server-side key for transactional email.",
    kind: "optional",
    group: "Email"
  },
  {
    name: "RESEND_FROM_EMAIL",
    purpose: "The verified sender address, for example BDM <ai@yourdomain.com>.",
    kind: "optional",
    group: "Email"
  },
  {
    name: "RESEND_WEBHOOK_SECRET",
    purpose: "Signing secret for the Resend webhook.",
    kind: "optional",
    group: "Email"
  }
];

/**
 * The presence of every variable the app reads.
 *
 * `present` is computed from a trimmed, non-empty string. No value is ever
 * returned, logged, or interpolated into the response.
 */
export function environmentStatus(): EnvVarStatus[] {
  return DEFINITIONS.map((definition) => ({
    name: definition.name,
    present: Boolean(process.env[definition.name]?.trim()),
    purpose: definition.purpose,
    kind: definition.kind,
    group: definition.group
  }));
}

/** The variables that are required but missing. */
export function missingRequired(): string[] {
  return environmentStatus()
    .filter((item) => item.kind === "required" && !item.present)
    .map((item) => item.name);
}
