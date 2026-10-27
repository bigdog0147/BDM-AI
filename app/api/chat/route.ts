/**
 * Chat API Route
 * Uses the agent framework for orchestrated multi-agent responses
 * with Supabase conversation persistence
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getProvider, initializeProviders, type ProviderType, isProviderError, type ChatMessage } from '@/lib/providers';
import { getMasterAgent } from '@/lib/agents';
import { registerBuiltinAgents } from '@/lib/agents';
import { retrieveRelevantMemories } from '@/lib/memory-store';
import { 
  getOrCreateSessionConversation, 
  addMessage, 
  getConversation 
} from '@/lib/conversations';

const SYSTEM_PROMPT = `You are BDM, a personal AI assistant.
Be capable, clear, practical, and truthful.
Never claim an action succeeded unless it actually did.
Respect user privacy, permission boundaries, applicable law, and security controls.
When current information is needed and web search is available, use it rather than guessing.
Your architecture is designed to gain more tools and memory over time.`;

// Initialize providers on module load
initializeProviders();

// Register built-in agents on module load
registerBuiltinAgents();

// Initialize MasterAgent singleton
const masterAgent = getMasterAgent();

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

async function generateUserId(request: NextRequest): Promise<string> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (url && key) {
      const supabase = createServerClient(url, key, {
        cookies: {
          getAll() { return request.cookies.getAll(); },
          setAll() {},
        },
      });
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) return session.user.id;
    }
  } catch { /* ignore */ }
  return crypto.randomUUID();
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const clientIp = getClientIp(request);
  const userId = await generateUserId(request);
  const startTime = Date.now();

  try {
    // Parse request body
    let body: { 
      message: string; 
      provider?: ProviderType; 
      model?: string;
      useOrchestration?: boolean;
      projectId?: string;
      conversationId?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { 
      message, 
      provider: providerType, 
      model,
      useOrchestration = true,
      projectId = 'default',
      conversationId,
    } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required and must be a string' },
        { status: 400 }
      );
    }

    if (message.length > 50000) {
      return NextResponse.json(
        { error: 'Message is too long (max 50000 characters)' },
        { status: 413 }
      );
    }

    // Best-effort retrieval of relevant memories for this turn. Non-blocking;
    // failures degrade gracefully so chat never breaks because storage is down.
    let memoryContext = "";
    try {
      const memories = await retrieveRelevantMemories(userId, message, {
        project: projectId === 'default' ? null : projectId,
      });
      if (memories.length > 0) {
        memoryContext = memories.map((m) => `- [${m.kind}] ${m.content.slice(0, 300)}`).join("\n");
      }
    } catch { /* memory retrieval is best-effort */ }

    // Validate provider availability (for direct mode fallback)
    let provider;
    try {
      provider = getProvider(providerType);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'No provider available' },
        { status: 503 }
      );
    }

    const available = await provider.isAvailable();
    if (!available) {
      return NextResponse.json(
        { error: `${provider.type} provider is not available` },
        { status: 503 }
      );
    }

    // Get or create conversation
    let conversation;
    try {
      conversation = await getOrCreateSessionConversation(userId, conversationId);
    } catch (error) {
      console.error("Failed to get/create conversation:", error);
      return NextResponse.json(
        { error: 'Failed to initialize conversation' },
        { status: 500 }
      );
    }

    // Save user message
    await addMessage(conversation.id, 'user', message.trim());

    // Get conversation history for context
    let conversationHistory: ChatMessage[] = [];
    try {
      const convWithMessages = await getConversation(conversation.id);
      if (convWithMessages?.messages) {
        conversationHistory = convWithMessages.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role, content: m.content }));
      }
    } catch (error) {
      console.error("Failed to load conversation history:", error);
    }

    // Process through MasterAgent with conversation context and memory context
    const result = await masterAgent.processRequest({
      requestId,
      userId,
      projectId,
      message: message.trim(),
      context: memoryContext ? { memoryContext } : undefined,
      options: {
        useOrchestration,
        preferredProvider: providerType,
        conversationHistory,
      },
    });

    const duration = Date.now() - startTime;

    // Save assistant response
    if (result.response) {
      await addMessage(conversation.id, 'assistant', result.response, {
        orchestrated: !!result.orchestration,
        provider: result.metadata.provider,
        model: result.metadata.model,
        tasksExecuted: result.metadata.tasksExecuted,
      });
    }

    // Log structured info (no secrets, no sensitive content)
    console.log(JSON.stringify({
      requestId,
      clientIp,
      userId,
      conversationId: conversation.id,
      provider: result.metadata.provider,
      model: result.metadata.model,
      durationMs: duration,
      orchestrated: !!result.orchestration,
      tasksExecuted: result.metadata.tasksExecuted,
      success: result.success,
    }));

    // Return consistent response format
    return NextResponse.json({
      id: requestId,
      text: result.response || '',
      conversationId: conversation.id,
      orchestrated: !!result.orchestration,
      orchestration: result.orchestration ? {
        planId: result.orchestration?.planId,
        completedTasks: result.orchestration?.completedTasks,
        failedTasks: result.orchestration?.failedTasks,
        errors: result.orchestration?.errors,
      } : undefined,
      model: result.metadata.model,
      provider: result.metadata.provider,
      usage: undefined, // TODO: aggregate from orchestration
    });

  } catch (error) {
    const duration = Date.now() - startTime;

    // Log error without sensitive data
    console.error(JSON.stringify({
      requestId,
      clientIp,
      userId,
      durationMs: duration,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: isProviderError(error) ? error.code : undefined,
    }));

    // Return sanitized error
    if (isProviderError(error)) {
      const statusCode = error.code === 'UNAUTHORIZED' ? 401 :
                        error.code === 'RATE_LIMITED' ? 429 :
                        error.code === 'MODEL_NOT_FOUND' ? 404 :
                        error.code === 'INVALID_REQUEST' ? 400 :
                        error.code === 'TIMEOUT' ? 504 :
                        error.code === 'UNSUPPORTED_OPERATION' ? 400 : 500;

      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: statusCode }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Return provider status for health/debugging
  const providers = initializeProviders();
  const status = await Promise.all(
    providers.map(async (p) => ({
      type: p.type,
      model: p.config.model,
      available: await p.isAvailable(),
      capabilities: p.getModelCapabilities(),
    }))
  );

  return NextResponse.json({
    ok: true,
    providers: status,
    defaultProvider: providers.find(p => p.type === 'openai') ? 'openai' :
                   providers.find(p => p.type === 'ollama') ? 'ollama' : null,
  });
}