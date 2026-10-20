# BDM AI

BDM is a standalone personal AI platform designed to become a continuously upgradeable assistant with memory, internet research, tools, voice, files, automation, and mobile applications.

## V1 Foundation

- Next.js 15+ web application with App Router
- OpenAI Responses API model gateway
- Optional built-in web search
- Supabase-ready data layer
- Render deployment blueprint
- Health endpoint at `/api/health`
- Starter BDM conversational interface

## Existing Supabase Foundation

The connected Supabase project already contains the BDM V1 tables:

- `bdm_profiles`
- `bdm_conversations`
- `bdm_messages`
- `bdm_memories`
- `bdm_knowledge_items`
- `bdm_tool_permissions`
- `bdm_audit_events`

Row Level Security is enabled on these tables.

## Tech Stack

- **Framework**: Next.js 15+ (App Router, React 19)
- **Language**: TypeScript (strict mode)
- **AI**: OpenAI API (chat completions)
- **Database**: Supabase (PostgreSQL with RLS)
- **Styling**: CSS Modules / Global CSS
- **Testing**: Vitest + React Testing Library
- **Linting**: ESLint (Next.js config) + Prettier
- **CI/CD**: GitHub Actions
- **Containerization**: Docker + Docker Compose
- **Deployment**: Render (configured via `render.yaml`)

## Prerequisites

- Node.js 22+
- npm 10+
- Docker & Docker Compose (optional)
- OpenAI API key
- Supabase project (URL + publishable key)

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your configuration

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Using Docker (Development)

```bash
# Start development environment
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Using Docker (Production)

```bash
# Build and start production containers
docker-compose -f docker-compose.yml up -d --build

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## Project Structure

```
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── chat/          # Chat API endpoint (POST)
│   │   └── health/        # Health check endpoint (GET)
│   ├── components/        # React components (Server Components by default)
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page (chat interface)
├── __tests__/             # Vitest tests
├── .github/
│   ├── workflows/         # CI/CD pipelines
│   └── dependabot.yml     # Automated dependency updates
├── .vscode/               # VS Code configuration
├── .opencode/             # OpenCode configuration
├── docker-compose.yml     # Production Docker Compose
├── docker-compose.override.yml  # Development overrides
├── Dockerfile             # Multi-stage Dockerfile
├── render.yaml            # Render deployment config
├── .env.example           # Environment variables template
├── .gitignore
├── .editorconfig
├── .eslintrc.json
├── .prettierrc
├── .npmrc
├── commitlint.config.js
├── .pre-commit-config.yaml
├── tsconfig.json
├── vitest.config.ts
├── vitest.setup.ts
├── package.json
└── README.md
```

## Available Scripts

```bash
# Development
npm run dev              # Start dev server with hot reload

# Building
npm run build            # Build for production
npm run start            # Start production server

# Code Quality
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint issues
npm run format           # Format with Prettier
npm run format:check     # Check formatting
npm run typecheck        # TypeScript type checking

# Testing
npm run test             # Run tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report

# Git Hooks
npm run prepare          # Install Husky hooks (runs automatically after install)
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key | Yes |
| `OPENAI_MODEL` | Model to use (default: gpt-5.6-luna) | No |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key | Yes |
| `BDM_WEB_SEARCH_ENABLED` | Enable web search (true/false) | No |

Copy `.env.example` to `.env.local` and fill in your values.

## API Endpoints

- `GET /api/health` - Health check
- `POST /api/chat` - Chat with BDM
  - Request: `{ "message": "string" }`
  - Response: `{ "text": "string" }`

## Database Schema

Managed in Supabase. Key tables:

```sql
-- Profiles
bdm_profiles (id, user_id, display_name, avatar_url, created_at)

-- Conversations
bdm_conversations (id, user_id, title, created_at, updated_at)

-- Messages
bdm_messages (id, conversation_id, role, content, metadata, created_at)

-- Memories
bdm_memories (id, user_id, content, embedding, metadata, created_at)

-- Knowledge
bdm_knowledge_items (id, user_id, title, content, source_url, embedding, created_at)

-- Tool Permissions
bdm_tool_permissions (id, user_id, tool_name, enabled, created_at)

-- Audit
bdm_audit_events (id, user_id, event_type, payload, created_at)
```

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push/PR:

1. **Lint & Test**: ESLint → Prettier → TypeScript → Vitest → Coverage
2. **Build Docker**: Multi-stage Docker build (main branch only)
3. **Deploy Preview**: Preview deployment for PRs
4. **Deploy Production**: Production deployment (main branch only)

## VS Code Setup

Recommended extensions are in `.vscode/extensions.json`. Debug configurations in `.vscode/launch.json` support:
- Debug Next.js dev server
- Debug tests
- Attach to Docker container

## OpenCode Integration

This project includes OpenCode configuration:
- `.opencode/config.json` - Main configuration
- `.opencode/agents/nextjs-developer.md` - Specialized Next.js agent
- `.opencode/commands/new-feature.md` - Feature creation command

Run `opencode` in the project root to start.

## Planned Upgrades (V1+)

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

## License

MIT