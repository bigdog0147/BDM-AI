import OpenAI from "openai";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are BDM, a personal AI assistant.
Be capable, clear, practical, and truthful.
Never claim an action succeeded unless it actually did.
Respect user privacy, permission boundaries, applicable law, and security controls.
When current information is needed and web search is available, use it rather than guessing.
Your architecture is designed to gain more tools and memory over time.`;

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return new OpenAI({ apiKey });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (!message) {
      return Response.json({ error: "message is required" }, { status: 400 });
    }

    if (message.length > 20000) {
      return Response.json({ error: "message is too long" }, { status: 413 });
    }

    const client = getClient();
    const tools =
      process.env.BDM_WEB_SEARCH_ENABLED === "true"
        ? [{ type: "web_search" as const }]
        : undefined;

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      instructions: SYSTEM_PROMPT,
      input: message,
      tools
    });

    return Response.json({
      id: response.id,
      text: response.output_text
    });
  } catch (error) {
    console.error("BDM chat error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "BDM request failed" },
      { status: 500 }
    );
  }
}
