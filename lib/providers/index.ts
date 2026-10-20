/**
 * Provider Registry and Factory
 * Manages provider registration, selection, and configuration
 */

// Re-export all types from types.ts
export type {
  ModelProvider,
  ProviderConfig,
  ProviderType,
  ProviderRegistry,
  ModelConfig,
  ChatMessage,
  ToolCall,
  Tool,
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatCompletionChunk,
  ProviderError,
} from './types';

// Re-export functions from types.ts
export { createProviderError, isProviderError } from './types';

import { OpenAIProvider, createOpenAIProviderFromEnv } from './openai';
import { OllamaProvider, createOllamaProviderFromEnv } from './ollama';
import type {
  ModelProvider,
  ProviderConfig,
  ProviderType,
  ProviderRegistry,
  ModelConfig,
} from './types';

class ProviderRegistryImpl implements ProviderRegistry {
  private providers = new Map<ProviderType, ModelProvider>();
  private defaultProviderType: ProviderType | null = null;

  getProvider(type: ProviderType): ModelProvider | undefined {
    return this.providers.get(type);
  }

  registerProvider(provider: ModelProvider): void {
    this.providers.set(provider.type, provider);
    if (!this.defaultProviderType) {
      this.defaultProviderType = provider.type;
    }
  }

  getDefaultProvider(): ModelProvider | undefined {
    if (this.defaultProviderType) {
      return this.providers.get(this.defaultProviderType);
    }
    // Prefer OpenAI if available, otherwise Ollama
    return this.providers.get('openai') || this.providers.get('ollama');
  }

  setDefaultProvider(type: ProviderType): void {
    if (!this.providers.has(type)) {
      throw new Error(`Provider ${type} is not registered`);
    }
    this.defaultProviderType = type;
  }

  listProviders(): ModelProvider[] {
    return Array.from(this.providers.values());
  }
}

export const providerRegistry = new ProviderRegistryImpl();

/**
 * Initialize providers from environment configuration
 */
export function initializeProviders(): ModelProvider[] {
  const providers: ModelProvider[] = [];

  // Initialize OpenAI provider if configured
  const openaiProvider = createOpenAIProviderFromEnv();
  if (openaiProvider) {
    providerRegistry.registerProvider(openaiProvider);
    providers.push(openaiProvider);
  }

  // Initialize Ollama provider if configured
  const ollamaProvider = createOllamaProviderFromEnv();
  if (ollamaProvider) {
    providerRegistry.registerProvider(ollamaProvider);
    providers.push(ollamaProvider);
  }

  // Set default provider based on explicit configuration or availability
  const preferredProvider = process.env.BDM_DEFAULT_PROVIDER as ProviderType | undefined;
  if (preferredProvider && providerRegistry.getProvider(preferredProvider)) {
    providerRegistry.setDefaultProvider(preferredProvider);
  } else if (openaiProvider) {
    providerRegistry.setDefaultProvider('openai');
  } else if (ollamaProvider) {
    providerRegistry.setDefaultProvider('ollama');
  }

  return providers;
}

/**
 * Get a provider by type, using the default if none specified
 */
export function getProvider(type?: ProviderType): ModelProvider {
  if (type) {
    const provider = providerRegistry.getProvider(type);
    if (!provider) {
      throw new Error(`Provider ${type} not available. Available: ${providerRegistry.listProviders().map(p => p.type).join(', ')}`);
    }
    return provider;
  }

  const defaultProvider = providerRegistry.getDefaultProvider();
  if (!defaultProvider) {
    throw new Error('No model provider configured. Set OPENAI_API_KEY or OLLAMA_ENDPOINT.');
  }
  return defaultProvider;
}

/**
 * Validate provider configuration
 */
export function validateProviderConfig(config: ProviderConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.type) {
    errors.push('Provider type is required');
  }

  if (config.type === 'openai' && !config.apiKey) {
    errors.push('OpenAI provider requires an API key');
  }

  if (!config.model) {
    errors.push('Model name is required');
  }

  if (config.timeout && config.timeout < 1000) {
    errors.push('Timeout must be at least 1000ms');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a provider from a configuration object
 */
export function createProvider(config: ProviderConfig): ModelProvider {
  const validation = validateProviderConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid provider config: ${validation.errors.join(', ')}`);
  }

  switch (config.type) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}

/**
 * Get all available models from all registered providers
 */
export async function getAllAvailableModels(): Promise<Record<ProviderType, ModelConfig[]>> {
  const result: Record<ProviderType, ModelConfig[]> = {
    openai: [],
    ollama: [],
  };

  const promises = providerRegistry.listProviders().map(async (provider) => {
    try {
      const models = await provider.listModels();
      result[provider.type] = models;
    } catch {
      result[provider.type] = [];
    }
  });

  await Promise.all(promises);
  return result;
}

/**
 * Get the best available provider for a given model
 */
export function getProviderForModel(modelName: string): ModelProvider | null {
  for (const provider of providerRegistry.listProviders()) {
    const capabilities = provider.getModelCapabilities();
    if (capabilities && (capabilities.id === modelName || capabilities.name === modelName)) {
      return provider;
    }
    // Check if provider supports the model name pattern
    try {
      const models = provider.listModels();
      // This is async, we can't do this synchronously
    } catch {
      // Ignore
    }
  }

  // Return default provider as fallback
  return providerRegistry.getDefaultProvider() ?? null;
}

/**
 * Check if a specific provider is available
 */
export async function checkProviderAvailability(type: ProviderType): Promise<boolean> {
  const provider = providerRegistry.getProvider(type);
  if (!provider) return false;
  return provider.isAvailable();
}