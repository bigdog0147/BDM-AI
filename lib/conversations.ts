import { createSupabaseClient, createSupabaseServiceClient } from "@/lib/supabase";

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

// Client for read operations (uses anon key with RLS)
const supabase = createSupabaseClient();

// Client for write operations (uses service role key, bypasses RLS)
const supabaseAdmin = createSupabaseServiceClient();

// Fixed anonymous user ID that we ensure exists
const ANONYMOUS_USER_ID = "00000000-0000-0000-0000-000000000001";

let userInitialized = false;

async function ensureAnonymousUser(): Promise<string> {
  if (userInitialized) return ANONYMOUS_USER_ID;
  
  // Try to insert the anonymous user if it doesn't exist
  const { error } = await supabaseAdmin
    .from("users")
    .upsert({ 
      id: ANONYMOUS_USER_ID, 
      email: "anonymous@bdm.local",
      created_at: new Date().toISOString()
    }, { onConflict: "id" });
  
  if (error) {
    console.warn("Could not upsert anonymous user:", error);
  }
  
  userInitialized = true;
  return ANONYMOUS_USER_ID;
}

/**
 * Create a new conversation
 */
export async function createConversation(
  userId: string,
  title: string = "New Conversation"
): Promise<Conversation | null> {
  // Use anonymous user ID for all anonymous sessions
  const anonUserId = await ensureAnonymousUser();
  
  const { data, error } = await supabaseAdmin
    .from("bdm_conversations")
    .insert({ user_id: userId, title })
    .select()
    .single();

  if (error) {
    console.error("Error creating conversation:", error);
    return null;
  }
  return data;
}

/**
 * Get a conversation with its messages
 */
export async function getConversation(
  conversationId: string
): Promise<ConversationWithMessages | null> {
  const { data: conversation, error: convError } = await supabase
    .from("bdm_conversations")
    .select("*")
    .eq("id", conversationId)
    .single();

  if (convError || !conversation) {
    return null;
  }

  const { data: messages, error: msgError } = await supabase
    .from("bdm_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (msgError) {
    console.error("Error fetching messages:", msgError);
    return null;
  }

  return { ...conversation, messages: messages || [] };
}

/**
 * Get all conversations for a user
 */
export async function getUserConversations(
  userId: string
): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from("bdm_conversations")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Error fetching conversations:", error);
    return [];
  }
  return data || [];
}

/**
 * Add a message to a conversation
 */
export async function addMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
  metadata?: Record<string, unknown>
): Promise<Message | null> {
  const { data, error } = await supabaseAdmin
    .from("bdm_messages")
    .insert({
      conversation_id: conversationId,
      role,
      content,
      metadata: metadata || {},
    })
    .select()
    .single();

  if (error) {
    console.error("Error adding message:", error);
    return null;
  }

  // Update conversation's updated_at
  await supabaseAdmin
    .from("bdm_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  return data;
}

/**
 * Update conversation title
 */
export async function updateConversationTitle(
  conversationId: string,
  title: string
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("bdm_conversations")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  return !error;
}

/**
 * Delete a conversation (cascades to messages via RLS/foreign key)
 */
export async function deleteConversation(conversationId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("bdm_conversations")
    .delete()
    .eq("id", conversationId);

  return !error;
}

/**
 * Get or create a conversation for the current session
 */
export async function getOrCreateSessionConversation(
  userId: string,
  sessionConversationId?: string
): Promise<Conversation> {
  if (sessionConversationId) {
    const existing = await getConversation(sessionConversationId);
    if (existing && existing.user_id === userId) {
      return existing;
    }
  }

  // Create new conversation
  const newConv = await createConversation(userId);
  if (!newConv) {
    throw new Error("Failed to create conversation");
  }
  return newConv;
}