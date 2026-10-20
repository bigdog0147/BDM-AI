---
name: new-feature
description: Create a new feature with API routes, components, and tests
arguments:
  - name: feature_name
    description: Name of the feature (kebab-case)
    required: true
  - name: description
    description: Brief description of the feature
    required: true
---

# Create New Feature: {{feature_name}}

## Description
{{description}}

## Implementation Checklist

### API Routes (if needed)
- [ ] Create `app/api/{{feature_name}}/route.ts`
- [ ] Add proper HTTP methods (GET, POST, PUT, DELETE)
- [ ] Add request validation with Zod
- [ ] Add error handling
- [ ] Add tests in `__tests__/{{feature_name}}.test.ts`

### Components (if needed)
- [ ] Create `app/components/{{feature_name}}.tsx`
- [ ] Use Server Component by default
- [ ] Add `'use client'` only if needed (hooks, interactivity)
- [ ] Add proper TypeScript props
- [ ] Add tests in `__tests__/{{feature_name}}.test.tsx`

### Database (if needed)
- [ ] Check existing Supabase tables
- [ ] Add new table migration if needed
- [ ] Update RLS policies
- [ ] Update TypeScript types

### Integration
- [ ] Update main page or create new page in `app/{{feature_name}}/page.tsx`
- [ ] Add navigation/link if needed
- [ ] Update environment variables in `.env.example`

### Testing
- [ ] Unit tests for API routes
- [ ] Component tests with React Testing Library
- [ ] E2E tests if critical path

## Commands to Run

```bash
# Run tests
npm run test

# Run linter
npm run lint

# Format code
npm run format

# Type check
npm run typecheck

# Build for production
npm run build
```