# BDM AI

BDM is a standalone personal AI platform designed to become a continuously upgradeable assistant with memory, internet research, tools, voice, files, automation, and mobile applications.

## V1 foundation

- Next.js web application
- OpenAI Responses API model gateway
- Optional built-in web search
- Supabase-ready data layer
- Render deployment blueprint
- Health endpoint at `/api/health`
- Starter BDM conversational interface

## Existing Supabase foundation

The connected Supabase project already contains the BDM V1 tables:

- `bdm_profiles`
- `bdm_conversations`
- `bdm_messages`
- `bdm_memories`
- `bdm_knowledge_items`
- `bdm_tool_permissions`
- `bdm_audit_events`

Row Level Security is enabled on these tables.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add your OpenAI API key to `OPENAI_API_KEY`.
3. Add the Supabase project URL and publishable key.
4. Run `npm install`.
5. Run `npm run dev`.

Never commit API keys or secret credentials.

## Planned upgrades

1. Supabase authentication and protected chat
2. Conversation persistence
3. Long-term memory retrieval and memory center
4. Tool permission engine
5. Source-backed web research
6. File and image intelligence
7. Voice
8. Automations
9. Specialist BDM agents
10. Android/iOS app clients
