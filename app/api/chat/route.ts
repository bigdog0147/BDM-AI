import { SYSTEM_PROMPT } from "../../../lib/prompt";
import { persistTurn } from "../../../lib/persist";
import { generateReply } from "../../../lib/ai";
import { safeError } from "../../../lib/errors";
import { currentUser } from "../../../lib/auth";
import {
  buildMemoryContext,
  containsSecret,
  findMemoriesToForget,
  parseMemoryCommand
} from "../../../lib/memory-core";
import {
  deleteMemory,
  listMemories,
  retrieveRelevantMemories,
  saveMemory
} from "../../../lib/memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 20000;
const MAX_PROJECT_LENGTH = 100;

/**
 * Simple in-process sliding-window rate limiter. This is a single-instance
 * guard, not a distributed one; a shared store is needed for multi-instance
 * deployments. Per-instance limits are still better than none.
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > MAX_REQUESTS_PER_WINDOW;
}

export type MemoryAction =
  | {
      type: "saved";
      memory: { id: string; content: string; kind: string };
    }
  | { type: "forgotten"; count: number; contents: string[]; ids: string[] }
  | { type: "blocked_secret" }
  | { type: "unavailable" }
  | { type: "not_found"; query: string };

export async function POST(request: Request): Promise<Response> {
  try {
    const identifier =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

    if (rateLimited(identifier)) {
      return Response.json(
        { error: "Too many requests. Please slow down." },
        { status: 429, headers: { "retry-after": "60" } }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const payload = body as
      | { message?: unknown; conversationId?: unknown; project?: unknown }
      | null;

    const raw = payload?.message;
    if (typeof raw !== "string") {
      return Response.json({ error: "message is required" }, { status: 400 });
    }

    const message = raw.trim();
    if (!message) {
      return Response.json({ error: "message is required" }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return Response.json({ error: "message is too long" }, { status: 413 });
    }

    // Optional conversation to continue. Ignored (never trusted for auth);
    // RLS on the server decides whether the caller may write to it.
    const rawConversationId = payload?.conversationId;
    const conversationId =
      typeof rawConversationId === "string" && rawConversationId.trim()
        ? rawConversationId.trim()
        : null;

    const rawProject = payload?.project;
    const project =
      typeof rawProject === "string" && rawProject.trim()
        ? rawProject.trim().slice(0, MAX_PROJECT_LENGTH)
        : null;

    // Memory requires a signed-in user; anonymous chat still works.
    const user = await currentUser();

    // ---- explicit memory instructions -----------------------------------
    // Handled deterministically: the reply must reflect what actually
    // happened in the database, so it is never left to the model to narrate.
    let memoryAction: MemoryAction | null = null;
    let confirmation: string | null = null;

    if (user) {
      const command = parseMemoryCommand(message);

      if (command?.action === "remember") {
        if (containsSecret(command.content)) {
          memoryAction = { type: "blocked_secret" };
          confirmation =
            "I did not save that. It looks like a credential or secret, and those are never stored in long-term memory.";
        } else {
          const result = await saveMemory({
            userId: user.id,
            content: command.content,
            kind: command.kind,
            project,
            sourceConversationId: conversationId
          });
          if (result.ok) {
            memoryAction = {
              type: "saved",
              memory: {
                id: result.memory.id,
                content: result.memory.content,
                kind: result.memory.kind
              }
            };
            confirmation = `Saved to memory as a ${result.memory.kind}: "${result.memory.content}"`;
          } else if (result.reason === "secret") {
            memoryAction = { type: "blocked_secret" };
            confirmation =
              "I did not save that. It looks like a credential or secret, and those are never stored in long-term memory.";
          } else {
            memoryAction = { type: "unavailable" };
            confirmation =
              "I could not save that to memory. Memory storage is unavailable right now, so nothing was saved.";
          }
        }
      } else if (command?.action === "forget") {
        const existing = await listMemories(user.id, { project });
        const matches = findMemoriesToForget(existing, command.query);
        if (matches.length === 0) {
          memoryAction = { type: "not_found", query: command.query };
          confirmation = `I could not find a saved memory matching "${command.query}", so nothing was deleted.`;
        } else {
          const deleted: string[] = [];
          for (const memory of matches) {
            if (await deleteMemory(user.id, memory.id)) deleted.push(memory.id);
          }
          if (deleted.length === 0) {
            memoryAction = { type: "unavailable" };
            confirmation =
              "I found a matching memory but could not delete it. Nothing was removed.";
          } else {
            const kept = matches.filter((memory) => deleted.includes(memory.id));
            memoryAction = {
              type: "forgotten",
              count: deleted.length,
              contents: kept.map((memory) => memory.content),
              ids: deleted
            };
            confirmation =
              deleted.length === 1
                ? `Forgotten: "${kept[0]?.content ?? ""}"`
                : `Forgotten ${deleted.length} memories.`;
          }
        }
      }
    }

    // ---- generate --------------------------------------------------------
    let text: string;
    let model: string;
    let provider: "ollama" | "openai";
    let memoriesUsed: { id: string; content: string; kind: string }[] = [];

    if (confirmation) {
      // A memory instruction is answered from the real outcome, not by the
      // model, and no provider call is made.
      text = confirmation;
      model = "memory";
      provider = "ollama";
    } else {
      if (user) {
        const retrieved = await retrieveRelevantMemories(user.id, message, {
          project,
          limit: 6
        });
        memoriesUsed = retrieved.map((memory) => ({
          id: memory.id,
          content: memory.content,
          kind: memory.kind
        }));
        const memoryContext = buildMemoryContext(retrieved);
        const system = memoryContext
          ? `${SYSTEM_PROMPT}\n\n${memoryContext}`
          : SYSTEM_PROMPT;

        const result = await generateReply({ system, user: message });
        text = result.text;
        model = result.model;
        provider = result.provider;
      } else {
        const result = await generateReply({
          system: SYSTEM_PROMPT,
          user: message
        });
        text = result.text;
        model = result.model;
        provider = result.provider;
      }
    }

    // Persist the turn only after a successful generation. Conversation
    // history is separate from memory: a "remember this" turn is still part
    // of the thread. Best-effort; never throws into the response path.
    const savedConversationId = await persistTurn({
      userMessage: message,
      assistantText: text,
      model,
      conversationId
    });

    return Response.json({
      id: `${provider}-${Date.now()}`,
      provider,
      model,
      text,
      conversationId: savedConversationId,
      memoryAction: memoryAction ?? undefined,
      memoriesUsed: memoriesUsed.length > 0 ? memoriesUsed : undefined
    });
  } catch (error) {
    // Log detail server-side only; never return it to the browser.
    console.error("BDM chat error", error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: safeError(message) }, { status: 500 });
  }
}
