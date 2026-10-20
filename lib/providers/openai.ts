/**
 * OpenAI Provider Adapter
 * Implements the ModelProvider interface for OpenAI API
 */

import OpenAI from 'openai';
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

const OPENAI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1';

export class OpenAIProvider implements ModelProvider {
  readonly type: ProviderType = 'openai';
  readonly config: ProviderConfig;
  private client: OpenAI | null = null;
  private modelCapabilities: ModelConfig | null = null;

  constructor(config: ProviderConfig) {
    this.config = {
      ...config,
      endpoint: config.endpoint || OPENAI_DEFAULT_ENDPOINT,
      timeout: config.timeout || 120000,
    };
  }

  private getClient(): OpenAI {
    if (!this.client) {
      if (!this.config.apiKey) {
        throw createProviderError(
          'OpenAI API key is not configured',
          'UNAUTHORIZED',
          'openai'
        );
      }
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.endpoint,
        timeout: this.config.timeout,
        maxRetries: 0, // We handle retries at a higher level
      });
    }
    return this.client;
  }

  async isAvailable(): Promise<boolean> {
    try {
      if (!this.config.apiKey) {
        return false;
      }
      const client = this.getClient();
      await client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelConfig[]> {
    try {
      const client = this.getClient();
      const response = await client.models.list();
      return response.data
        .filter((model) => model.id.startsWith('gpt-') || model.id.startsWith('o1-'))
        .map((model) => ({
          id: model.id,
          name: model.id,
          supportsTools: !model.id.includes('instruct'),
          supportsJsonMode: !model.id.includes('instruct'),
          supportsStreaming: true,
          maxTokens: this.getModelMaxTokens(model.id),
          contextWindow: this.getModelContextWindow(model.id),
        }));
    } catch (error) {
      if (isProviderError(error)) throw error;
      throw createProviderError(
        `Failed to list OpenAI models: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NETWORK_ERROR',
        'openai',
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  private getModelMaxTokens(modelId: string): number {
    if (modelId.startsWith('gpt-4o')) return 16384;
    if (modelId.startsWith('gpt-4')) return 8192;
    if (modelId.startsWith('gpt-3.5')) return 4096;
    if (modelId.startsWith('o1-')) return 32768;
    return 4096;
  }

  private getModelContextWindow(modelId: string): number {
    if (modelId.startsWith('gpt-4o')) return 128000;
    if (modelId.startsWith('gpt-4-turbo')) return 128000;
    if (modelId.startsWith('gpt-4')) return 8192;
    if (modelId.startsWith('gpt-3.5')) return 16385;
    if (modelId.startsWith('o1-')) return 200000;
    return 4096;
  }

  getModelCapabilities(): ModelConfig | null {
    if (this.modelCapabilities) return this.modelCapabilities;
    const maxTokens = this.getModelMaxTokens(this.config.model);
    const contextWindow = this.getModelContextWindow(this.config.model);
    this.modelCapabilities = {
      id: this.config.model,
      name: this.config.model,
      supportsTools: !this.config.model.includes('instruct'),
      supportsJsonMode: !this.config.model.includes('instruct'),
      supportsStreaming: true,
      maxTokens,
      contextWindow,
    };
    return this.modelCapabilities;
  }

  private mapFinishReason(reason: string | null): ChatCompletionResult['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'error';
    }
  }

  private mapToolCalls(toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined): ChatCompletionResult['toolCalls'] {
    if (!toolCalls) return null;
    return toolCalls
      .filter((tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => 
        tc.type === 'function' && 'function' in tc
      )
      .map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
  }

  private mapMessages(messages: ChatCompletionOptions['messages']): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      const base = {
        role: msg.role,
        content: msg.content,
      } as OpenAI.Chat.Completions.ChatCompletionMessageParam;

      if (msg.role === 'assistant' && msg.toolCalls) {
        return {
          ...base,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        };
      }

      if (msg.role === 'tool') {
        return {
          role: 'tool' as const,
          content: msg.content,
          tool_call_id: msg.toolCallId || '',
        };
      }

      return base;
    });
  }

  private mapTools(tools?: ChatCompletionOptions['tools']): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
    if (!tools) return undefined;
    // Filter out web_search tools as they're not supported in Chat Completions API
    return tools
      .filter((tool) => tool.type !== 'web_search')
      .map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.function!.name,
          description: tool.function!.description,
          parameters: tool.function!.parameters,
        },
      }));
  }

  async chatComplete(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const client = this.getClient();

    try {
      const response = await client.chat.completions.create({
        model: options.model || this.config.model,
        messages: this.mapMessages(options.messages),
        tools: this.mapTools(options.tools),
        tool_choice: options.toolChoice,
        max_tokens: options.maxTokens,
        temperature: options.temperature ?? 0.7,
        stream: false,
        response_format: options.responseFormat,
      });

      const choice = response.choices[0];
      if (!choice) {
        throw createProviderError(
          'No completion choices returned',
          'MALFORMED_RESPONSE',
          'openai'
        );
      }

      return {
        id: response.id,
        model: response.model,
        content: choice.message.content,
        toolCalls: this.mapToolCalls(choice.message.tool_calls),
        finishReason: this.mapFinishReason(choice.finish_reason),
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      if (isProviderError(error)) throw error;
      if (error instanceof OpenAI.APIError) {
        switch (error.status) {
          case 401:
            throw createProviderError(
              'Invalid OpenAI API key',
              'UNAUTHORIZED',
              'openai',
              { statusCode: 401, retryable: false }
            );
          case 429:
            throw createProviderError(
              'OpenAI rate limit exceeded',
              'RATE_LIMITED',
              'openai',
              { statusCode: 429, retryable: true }
            );
          case 404:
            throw createProviderError(
              `Model ${options.model || this.config.model} not found`,
              'MODEL_NOT_FOUND',
              'openai',
              { statusCode: 404, retryable: false }
            );
          case 400:
            throw createProviderError(
              `Invalid request: ${error.message}`,
              'INVALID_REQUEST',
              'openai',
              { statusCode: 400, retryable: false }
            );
          default:
            throw createProviderError(
              `OpenAI API error: ${error.message}`,
              'NETWORK_ERROR',
              'openai',
              { statusCode: error.status, retryable: error.status ? error.status >= 500 : true }
            );
        }
      }
      // Check for timeout/connection errors by name since they may not be exported
      const errorName = error instanceof Error ? error.constructor.name : '';
      if (errorName === 'APITimeoutError' || errorName === 'TimeoutError') {
        throw createProviderError(
          'OpenAI request timed out',
          'TIMEOUT',
          'openai',
          { retryable: true }
        );
      }
      if (errorName === 'APIConnectionError' || errorName === 'ConnectionError') {
        throw createProviderError(
          `OpenAI connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'NETWORK_ERROR',
          'openai',
          { retryable: true, cause: error instanceof Error ? error : undefined }
        );
      }
      throw createProviderError(
        `OpenAI request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NETWORK_ERROR',
        'openai',
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  async streamChatComplete(
    options: ChatCompletionOptions,
    onChunk: (chunk: ChatCompletionChunk) => void
  ): Promise<void> {
    const client = this.getClient();

    try {
      const stream = await client.chat.completions.create({
        model: options.model || this.config.model,
        messages: this.mapMessages(options.messages),
        tools: this.mapTools(options.tools),
        tool_choice: options.toolChoice,
        max_tokens: options.maxTokens,
        temperature: options.temperature ?? 0.7,
        stream: true,
        response_format: options.responseFormat,
      });

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        onChunk({
          id: chunk.id,
          model: chunk.model,
          delta: {
            content: choice.delta.content ?? null,
            toolCalls: choice.delta.tool_calls?.map((tc) => ({
              id: tc.id || '',
              type: 'function' as const,
              function: {
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || '',
              },
            })),
          },
          finishReason: choice.finish_reason ? this.mapFinishReason(choice.finish_reason) : null,
        });
      }
    } catch (error) {
      if (isProviderError(error)) throw error;
      throw createProviderError(
        `OpenAI streaming failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NETWORK_ERROR',
        'openai',
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }
}

/**
 * Create an OpenAI provider from environment variables
 */
export function createOpenAIProviderFromEnv(): OpenAIProvider | null {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
  const endpoint = process.env.OPENAI_ENDPOINT;

  if (!apiKey) {
    return null;
  }

  return new OpenAIProvider({
    type: 'openai',
    apiKey,
    model,
    endpoint,
  });
}