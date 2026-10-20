/**
 * Ollama Provider Adapter
 * Implements the ModelProvider interface for Ollama local API
 */

import {
  ModelProvider,
  ProviderConfig,
  ProviderType,
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatCompletionChunk,
  ModelConfig,
  ProviderError,
  isProviderError,
  createProviderError,
} from './types';

const OLLAMA_DEFAULT_ENDPOINT = 'http://localhost:11434';

interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: string;
      };
    }>;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaModelsResponse {
  models: OllamaModel[];
}

interface OllamaShowResponse {
  model: string;
  capabilities: string[];
  details: {
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
  modified_at: string;
  template: string;
}

export class OllamaProvider implements ModelProvider {
  readonly type: ProviderType = 'ollama';
  readonly config: ProviderConfig;
  private baseUrl: string;
  private modelCapabilities: ModelConfig | null = null;

  constructor(config: ProviderConfig) {
    this.config = {
      ...config,
      endpoint: config.endpoint || OLLAMA_DEFAULT_ENDPOINT,
      timeout: config.timeout || 300000, // 5 minutes for local models
    };
    this.baseUrl = (this.config.endpoint || OLLAMA_DEFAULT_ENDPOINT).replace(/\/$/, '');
  }

  private async fetchWithTimeout(url: string, options: RequestInit, timeout: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw createProviderError(
          'Ollama request timed out',
          'TIMEOUT',
          'ollama',
          { retryable: true }
        );
      }
      throw createProviderError(
        `Ollama network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NETWORK_ERROR',
        'ollama',
        { retryable: true, cause: error instanceof Error ? error : undefined }
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET' },
        5000
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelConfig[]> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET' },
        this.config.timeout || 30000
      );

      if (!response.ok) {
        throw createProviderError(
          `Ollama returned ${response.status}: ${response.statusText}`,
          'NETWORK_ERROR',
          'ollama',
          { statusCode: response.status }
        );
      }

      const data = await response.json() as OllamaModelsResponse;
      return data.models.map((model) => ({
        id: model.name,
        name: model.name,
        supportsTools: this.checkToolSupport(model.name),
        supportsJsonMode: true,
        supportsStreaming: true,
        maxTokens: this.estimateMaxTokens(model.name),
        contextWindow: this.estimateContextWindow(model.name),
      }));
    } catch (error) {
      if (isProviderError(error)) throw error;
      throw createProviderError(
        `Failed to list Ollama models: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NETWORK_ERROR',
        'ollama',
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  private checkToolSupport(modelName: string): boolean {
    // Models known to support tools/function calling
    const toolSupportModels = [
      'llama3.1',
      'llama3.2',
      'mistral',
      'mixtral',
      'nemotron',
      'qwen2.5',
      'command-r',
      'aya',
    ];
    return toolSupportModels.some((m) => modelName.toLowerCase().includes(m.toLowerCase()));
  }

  private estimateMaxTokens(modelName: string): number {
    const lower = modelName.toLowerCase();
    if (lower.includes('32k') || lower.includes('128k')) return 32768;
    if (lower.includes('16k')) return 16384;
    if (lower.includes('8k') || lower.includes('7b') || lower.includes('8b')) return 8192;
    return 4096;
  }

  private estimateContextWindow(modelName: string): number {
    const lower = modelName.toLowerCase();
    if (lower.includes('128k')) return 131072;
    if (lower.includes('32k')) return 32768;
    if (lower.includes('16k')) return 16384;
    if (lower.includes('8k') || lower.includes('7b') || lower.includes('8b')) return 8192;
    return 4096;
  }

  async getModelInfo(modelName: string): Promise<OllamaShowResponse | null> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/show`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modelName }),
        },
        this.config.timeout || 30000
      );

      if (!response.ok) return null;
      return await response.json() as OllamaShowResponse;
    } catch {
      return null;
    }
  }

  getModelCapabilities(): ModelConfig | null {
    if (this.modelCapabilities) return this.modelCapabilities;

    const maxTokens = this.estimateMaxTokens(this.config.model);
    const contextWindow = this.estimateContextWindow(this.config.model);
    const supportsTools = this.checkToolSupport(this.config.model);

    this.modelCapabilities = {
      id: this.config.model,
      name: this.config.model,
      supportsTools,
      supportsJsonMode: true,
      supportsStreaming: true,
      maxTokens,
      contextWindow,
    };
    return this.modelCapabilities;
  }

  private mapFinishReason(done: boolean, hasToolCalls: boolean): ChatCompletionResult['finishReason'] {
    if (!done) return 'stop';
    if (hasToolCalls) return 'tool_calls';
    return 'stop';
  }

  private mapToolCalls(toolCalls: OllamaChatResponse['message']['tool_calls']): ChatCompletionResult['toolCalls'] {
    if (!toolCalls) return null;
    return toolCalls.map((tc, index) => ({
      id: `call_${index}`,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));
  }

  private formatMessages(messages: ChatCompletionOptions['messages']): Array<{
    role: string;
    content: string;
    tool_calls?: Array<{ function: { name: string; arguments: string } }>;
    tool_call_id?: string;
  }> {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      tool_calls: msg.toolCalls?.map((tc) => ({
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
      tool_call_id: msg.toolCallId,
    }));
  }

  async chatComplete(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const model = options.model || this.config.model;
    const capabilities = this.getModelCapabilities();

    // Validate tool usage if requested
    if (options.tools && options.tools.length > 0 && capabilities && !capabilities.supportsTools) {
      throw createProviderError(
        `Model ${model} does not support tool calling`,
        'UNSUPPORTED_OPERATION',
        'ollama'
      );
    }

    // Validate JSON mode
    if (options.responseFormat?.type === 'json_object' && capabilities && !capabilities.supportsJsonMode) {
      throw createProviderError(
        `Model ${model} does not support JSON mode`,
        'UNSUPPORTED_OPERATION',
        'ollama'
      );
    }

    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: this.formatMessages(options.messages),
            tools: options.tools?.map((tool) => {
              if (tool.type === 'web_search') {
                return { type: 'web_search' as const };
              }
              return {
                type: 'function' as const,
                function: {
                  name: tool.function!.name,
                  description: tool.function!.description,
                  parameters: tool.function!.parameters,
                },
              };
            }),
            stream: false,
            options: {
              temperature: options.temperature ?? 0.7,
              num_predict: options.maxTokens,
            },
          }),
        },
        this.config.timeout || 300000
      );

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 404) {
          throw createProviderError(
            `Model ${model} not found in Ollama`,
            'MODEL_NOT_FOUND',
            'ollama',
            { statusCode: 404 }
          );
        }
        throw createProviderError(
          `Ollama error: ${response.status} - ${errorText}`,
          'NETWORK_ERROR',
          'ollama',
          { statusCode: response.status }
        );
      }

      const data = await response.json() as OllamaChatResponse;

      return {
        id: `ollama_${Date.now()}`,
        model: data.model,
        content: data.message.content,
        toolCalls: this.mapToolCalls(data.message.tool_calls),
        finishReason: this.mapFinishReason(data.done, !!data.message.tool_calls?.length),
        usage: data.prompt_eval_count && data.eval_count
          ? {
              promptTokens: data.prompt_eval_count,
              completionTokens: data.eval_count,
              totalTokens: data.prompt_eval_count + data.eval_count,
            }
          : undefined,
      };
    } catch (error) {
      if (isProviderError(error)) throw error;
      throw createProviderError(
        `Ollama request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NETWORK_ERROR',
        'ollama',
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  async streamChatComplete(
    options: ChatCompletionOptions,
    onChunk: (chunk: ChatCompletionChunk) => void
  ): Promise<void> {
    const model = options.model || this.config.model;
    const capabilities = this.getModelCapabilities();

    if (options.tools && options.tools.length > 0 && capabilities && !capabilities.supportsTools) {
      throw createProviderError(
        `Model ${model} does not support tool calling`,
        'UNSUPPORTED_OPERATION',
        'ollama'
      );
    }

    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: this.formatMessages(options.messages),
            tools: options.tools?.map((tool) => {
              if (tool.type === 'web_search') {
                return { type: 'web_search' as const };
              }
              return {
                type: 'function' as const,
                function: {
                  name: tool.function!.name,
                  description: tool.function!.description,
                  parameters: tool.function!.parameters,
                },
              };
            }),
            stream: true,
            options: {
              temperature: options.temperature ?? 0.7,
              num_predict: options.maxTokens,
            },
          }),
        },
        this.config.timeout || 300000
      );

      if (!response.ok) {
        throw createProviderError(
          `Ollama stream error: ${response.status}`,
          'NETWORK_ERROR',
          'ollama',
          { statusCode: response.status }
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw createProviderError(
          'No response body from Ollama',
          'MALFORMED_RESPONSE',
          'ollama'
        );
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line) as OllamaChatResponse;
            const choice = data.message;

            onChunk({
              id: `ollama_${Date.now()}`,
              model: data.model,
              delta: {
                content: choice.content || null,
                toolCalls: choice.tool_calls?.map((tc, index) => ({
                  id: `call_${index}`,
                  type: 'function' as const,
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                  },
                })),
              },
              finishReason: data.done ? this.mapFinishReason(data.done, !!choice.tool_calls?.length) : null,
            });
          } catch {
            // Ignore parsing errors for incomplete chunks
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer) as OllamaChatResponse;
          onChunk({
            id: `ollama_${Date.now()}`,
            model: data.model,
            delta: {
              content: data.message.content || null,
              toolCalls: data.message.tool_calls?.map((tc, index) => ({
                id: `call_${index}`,
                type: 'function' as const,
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                },
              })),
            },
            finishReason: this.mapFinishReason(data.done, !!data.message.tool_calls?.length),
          });
        } catch {
          // Ignore
        }
      }
    } catch (error) {
      if (isProviderError(error)) throw error;
      throw createProviderError(
        `Ollama streaming failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NETWORK_ERROR',
        'ollama',
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }
}

/**
 * Create an Ollama provider from environment variables
 */
export function createOllamaProviderFromEnv(): OllamaProvider | null {
  const endpoint = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.1';

  // Ollama doesn't require an API key for local usage
  return new OllamaProvider({
    type: 'ollama',
    endpoint,
    model,
  });
}