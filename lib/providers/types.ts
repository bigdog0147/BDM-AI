/**
 * Model Provider Abstraction Layer
 * Provides a unified interface for OpenAI and Ollama providers
 */

export type ProviderType = 'openai' | 'ollama';

export interface ModelConfig {
  id: string;
  name: string;
  supportsTools?: boolean;
  supportsJsonMode?: boolean;
  supportsStreaming?: boolean;
  maxTokens?: number;
  contextWindow?: number;
}

export interface ProviderConfig {
  type: ProviderType;
  endpoint?: string;
  apiKey?: string;
  model: string;
  timeout?: number;
  defaultModel?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  type: 'function' | 'web_search';
  function?: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionOptions {
  model?: string;
  messages: ChatMessage[];
  tools?: Tool[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  responseFormat?: { type: 'json_object' } | { type: 'text' };
}

export interface ChatCompletionResult {
  id: string;
  model: string;
  content: string | null;
  toolCalls: ToolCall[] | null;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ModelProvider {
  readonly type: ProviderType;
  readonly config: ProviderConfig;

  /**
   * Check if the provider is available and properly configured
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get available models from the provider
   */
  listModels(): Promise<ModelConfig[]>;

  /**
   * Execute a chat completion request
   */
  chatComplete(options: ChatCompletionOptions): Promise<ChatCompletionResult>;

  /**
   * Execute a streaming chat completion request
   */
  streamChatComplete(
    options: ChatCompletionOptions,
    onChunk: (chunk: ChatCompletionChunk) => void
  ): Promise<void>;

  /**
   * Get the configured model's capabilities
   */
  getModelCapabilities(): ModelConfig | null;
}

export interface ChatCompletionChunk {
  id: string;
  model: string;
  delta: {
    content?: string | null;
    toolCalls?: ToolCall[];
  };
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' | null;
}

export interface ProviderError extends Error {
  code: 'UNAVAILABLE' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'MODEL_NOT_FOUND' | 'INVALID_REQUEST' | 'TIMEOUT' | 'NETWORK_ERROR' | 'MALFORMED_RESPONSE' | 'UNSUPPORTED_OPERATION';
  provider: ProviderType;
  statusCode?: number;
  retryable: boolean;
}

export function createProviderError(
  message: string,
  code: ProviderError['code'],
  provider: ProviderType,
  options: { statusCode?: number; retryable?: boolean; cause?: Error } = {}
): ProviderError {
  const error = new Error(message) as ProviderError;
  error.code = code;
  error.provider = provider;
  error.statusCode = options.statusCode;
  error.retryable = options.retryable ?? false;
  if (options.cause) {
    error.stack = `${error.stack}\nCaused by: ${options.cause.stack}`;
  }
  return error;
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof Error && 'code' in error && 'provider' in error && 'retryable' in error;
}

export interface ProviderRegistry {
  getProvider(type: ProviderType): ModelProvider | undefined;
  registerProvider(provider: ModelProvider): void;
  getDefaultProvider(): ModelProvider | undefined;
  setDefaultProvider(type: ProviderType): void;
  listProviders(): ModelProvider[];
}