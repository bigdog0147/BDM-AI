/**
 * Browser-safe error translation.
 *
 * Provider errors can contain model names, env-var names, URLs and upstream
 * status details. None of that should reach the browser, so every route
 * funnels messages through here and maps them to a stable, human-readable
 * sentence. The original message is only ever logged server-side.
 */
export function safeError(message: string): string {
  // ---- configuration -----------------------------------------------------
  if (message.includes("OPENAI_API_KEY")) return "AI provider is not configured";
  if (message.includes("OPENAI_MODEL")) return "AI model is not configured";
  if (message.includes("OLLAMA_MODEL")) return "Local model is not configured";
  if (message.includes("Unknown AI_PROVIDER")) return "AI provider is misconfigured";

  // ---- chat providers ----------------------------------------------------
  if (message.includes("ollama unreachable")) {
    return "The local assistant (Ollama) is not running. Start Ollama and try again.";
  }
  if (message.includes("ollama model not found")) {
    return "The configured local model is not installed. Pull it in Ollama and try again.";
  }
  if (message.includes("ollama cloud unavailable")) {
    return "The hosted model is unavailable. Check the Ollama API key, or sign in with 'ollama signin', and try again.";
  }
  if (message.includes("ollama timeout")) {
    return "The local assistant timed out. Please try again.";
  }
  if (message.includes("ollama malformed") || message.includes("ollama empty")) {
    return "The local assistant returned an unexpected response.";
  }
  if (message.includes("ollama error")) {
    return "The local assistant reported an error. Please try again.";
  }

  // ---- research ----------------------------------------------------------
  if (message.includes("search not configured")) {
    return "Web research is not configured. Add a search provider key to enable it.";
  }
  if (message.includes("search unauthorized")) {
    return "The search provider rejected the configured credentials.";
  }
  if (message.includes("search rate limited")) {
    return "The search provider is rate limiting requests. Try again shortly.";
  }
  if (message.includes("search timeout")) {
    return "The search provider timed out before returning results.";
  }
  if (message.includes("search failed")) {
    return "The search provider could not be reached.";
  }

  // ---- image generation --------------------------------------------------
  if (message.includes("image not configured")) {
    return "Image generation is not configured. Add an OpenAI API key to enable it.";
  }
  if (message.includes("image rate limited")) {
    return "The image provider is rate limiting requests. Try again shortly.";
  }
  if (message.includes("image timeout")) {
    return "The image provider timed out. Try again.";
  }
  if (message.includes("image failed")) {
    return "The image provider could not generate an image.";
  }

  // ---- transcription -----------------------------------------------------
  if (message.includes("transcription not configured")) {
    return "Voice transcription is not configured. Add an OpenAI API key to enable it.";
  }
  if (message.includes("transcription timeout")) {
    return "Transcription timed out. Try a shorter recording.";
  }
  if (message.includes("transcription failed")) {
    return "The recording could not be transcribed.";
  }

  // ---- generic -----------------------------------------------------------
  if (message.includes("timeout") || message.includes("timed out")) {
    return "The request timed out. Please try again.";
  }
  if (message.includes("rate limit") || message.includes("429")) {
    return "The assistant is busy. Please try again shortly.";
  }
  return "The assistant could not complete the request.";
}

/** Same mapping, for callers that want a status code alongside it. */
export function safeErrorStatus(message: string): number {
  if (
    message.includes("not configured") ||
    message.includes("OPENAI_API_KEY") ||
    message.includes("Unknown AI_PROVIDER")
  ) {
    return 503;
  }
  if (message.includes("unauthorized")) return 502;
  if (message.includes("rate limited") || message.includes("429")) return 429;
  if (message.includes("timeout") || message.includes("timed out")) return 504;
  return 500;
}
