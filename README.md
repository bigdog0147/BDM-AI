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

## Known dependency advisories

`npm audit` reports 5 high-severity advisories. All of them are **dev
tooling** and none of them ship with the application — the chain starts
inside the Next.js lint plugin:

```
eslint-config-next
└── @next/eslint-plugin-next
    └── fast-glob
        └── micromatch
            └── braces      ← GHSA-vfj7-8cjw-p6xm
```

`braces` is published only up to `3.0.3`, and the advisory covers
`<= 3.0.3` — the newest release is the affected one, so no upgrade can clear
it. `npm audit --omit=dev` (the production tree) reports **0**.

How this is handled:

- **Production dependencies are gated in CI.** `npm audit --omit=dev
  --audit-level=high` must pass; it is green today and blocks on any
  high-or-worse advisory in the shipped tree.
- **Dev advisories are ratcheted, not ignored.** A weekly job compares the
  count against `.audit-baseline.json` and fails only if it rises. When an
  upstream fix lands and the count drops, lower the baseline.
- The lint step is bounded by `timeout-minutes: 10`, so a pathological glob
  can fail a pipeline rather than stall one.

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
