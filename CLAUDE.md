# AppBoard Backend

## Overview
Backend API for AppBoard — an ASO (App Store Optimization) management tool. Manages store connections, app metadata, and listing optimization.
Admin Panel - /Users/erykkruk/Development/Github/AppBoard/appboard_web
Website - /Users/erykkruk/Development/Github/AppBoard/appboard_website


## Tech Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Runtime | Bun | 1.3.x |
| Framework | Elysia | 1.4.x |
| Database | PostgreSQL | 18 |
| ORM | Drizzle ORM | 0.45.x |
| Validation | ArkType | 2.1.x |
| Linter/Formatter | Biome | 2.3.x |
| Logger | Pino | 10.x |
| Package Manager | bun | - |

## Development Commands

| Command | Description |
|---------|------------|
| `bun run dev` | Start dev server with watch mode |
| `bun run start` | Start production server |
| `bun test` | Run tests |
| `bun run db:up` | Start PostgreSQL container |
| `bun run db:generate` | Generate Drizzle migrations |
| `bunx biome check --write .` | Lint and format all files |

## Directory Structure

```
src/
├── config/
│   ├── index.ts          # ArkType-validated env config
│   └── const.ts          # Shared constants, enums, types
├── modules/
│   ├── pagination/
│   │   └── index.ts      # Pagination Elysia macro
│   └── system/
│       ├── index.ts       # Health endpoint + bootstrap
│       ├── db.service.ts  # Paginated query helper
│       └── pagination.service.ts # Pagination response builder
├── utils/
│   ├── db/
│   │   ├── index.ts       # Drizzle client
│   │   ├── schema.ts      # Database tables
│   │   ├── relations.ts   # Drizzle relations
│   │   ├── migrate.ts     # Migration runner
│   │   └── drizzle/       # Generated SQL migrations
│   ├── errors/
│   │   ├── index.ts       # Error types + buildError()
│   │   └── errorHandler.ts # Global Elysia error handler
│   ├── crypto.ts          # AES-256-GCM encrypt/decrypt
│   ├── helpers.ts         # Shared helper functions
│   └── logger.ts          # Pino logger factory
├── test/
│   ├── setup.ts           # Test setup
│   ├── health.test.ts     # Health endpoint tests
│   ├── crypto.test.ts     # Crypto utility tests
│   └── errors.test.ts     # Error utility tests
└── index.ts               # App entry point
```

## Architecture Pattern

Feature-based modules under `src/modules/`. Each module contains its own controller, service, and types. Shared utilities live in `src/utils/`.

## Module Structure

```
src/modules/{feature}/
├── index.ts              # Elysia controller (routes)
├── {feature}.service.ts  # Business logic
├── {feature}.types.ts    # Feature-specific types
└── {feature}.test.ts     # Feature tests
```

## Naming Conventions

- Files: kebab-case (e.g., `error-handler.ts`) or dot-notation for services (e.g., `db.service.ts`)
- Classes: PascalCase
- Functions: camelCase
- Constants: SCREAMING_SNAKE_CASE
- DB tables: snake_case (handled by Drizzle casing config)

## Error Handling

Use `buildError()` from `@/utils/errors`:
```typescript
import { buildError } from "@/utils/errors";
buildError("notFound", { info: "App not found" });
```

All errors are typed via the `errors` object. Never throw raw errors.

## Multi-tenancy (Workspace Scoping)

All data is workspace-scoped. Every endpoint MUST operate within the authenticated user's workspace context.

- Auth guard (`src/modules/auth/index.ts`) derives `userId` + `workspaceId` from request
- Every store-scoped endpoint must call `verifyStoreOwnership(storeId, workspaceId!)`
- Every app-scoped endpoint must call `verifyAppOwnership(appId, workspaceId!)` (joins through stores)
- Service methods that query data MUST filter by `workspaceId` — never return cross-workspace results
- Settings use `(workspaceId, key)` unique constraint — same key can exist per workspace

### Testing workspace context
- ALL tests MUST run authenticated via `authRequest()` from `test/setup.ts` (workspace A)
- Use `authRequestB()` for cross-workspace isolation tests (workspace B)
- `seedTestStore()` accepts optional `workspaceId` (defaults to workspace A)
- When writing new tests: always verify that workspace B cannot access workspace A resources
- Integration tests should cover the full flow: connect → sync → save → publish

## Feature Flags System

Workspace-scoped toggles for 12 modules. Reuses the `settings` table with `FEATURE_` prefix — no new migrations.

- **Definitions**: `src/modules/features/features.const.ts` — `FEATURE_DEFINITIONS`, `ROUTE_FEATURE_MAP`, `matchesPathPattern()`
- **Service**: `src/modules/features/features.service.ts` — `getAll()`, `isEnabled()`, `setAll()` (transactional)
- **Controller**: `src/modules/features/index.ts` — `GET /api/features`, `PATCH /api/features`
- **Guard**: `src/modules/features/features.guard.ts` — scoped `onBeforeHandle` hook returning 403 for disabled features

**Dependency cascade**: `dependsOn` in a definition forces a feature `false` when any dep is `false` (e.g., `MONETIZATION_CHAT` depends on `AI` + `PURCHASES`). Handled in `applyDependencyCascade()`.

**Path matching**: `matchesPathPattern()` uses segment-based subsequence matching — prevents `/api/ai` from matching `/api/ai-chat-history`.

**Registration order** (`src/index.ts`): `featuresController` → `featureGuard` → all other controllers. Guard must run BEFORE protected controllers inside the `/api` group.

## History + Diff System

GitHub-style version control for listing fields.

- **History**: `src/modules/history/` — `GET /apps/:id/history` (filters: `language`, `field`), `POST /apps/:id/history/:historyId/rollback`. Rollback updates the draft listing and marks `isDirty`.
- **Draft diffs**: `ListingsService.getDraftDiffs(appId)` in `listings.service.ts` + endpoint `GET /apps/:id/listings/diffs` — compares draft vs remote listings per language, returns only changed fields.
- **Underlying data**: `listingHistory` table tracks `oldValue`/`newValue` per field per language on publish.

## Anti-patterns

- NEVER use `console.log` — use `createLogger()` from `@/utils/logger`
- NEVER hardcode secrets — use config from `@/config`
- NEVER put business logic in controllers — use service classes
- NEVER use raw SQL — use Drizzle ORM
- NEVER store credentials unencrypted — use `encrypt()`/`decrypt()` from `@/utils/crypto`
- NEVER use `any` type
- NEVER skip workspace scoping — every endpoint MUST use `workspaceId` from auth guard
- NEVER write tests without auth context — always use `authRequest()` or `authRequestB()`

## Best Practices

- ALWAYS validate env config with ArkType schema in `@/config`
- ALWAYS use `@/` path aliases for imports
- ALWAYS format with `bunx biome check --write` before committing
- ALWAYS run `bun test` before committing
- ALWAYS use the pagination macro for list endpoints
- ALWAYS export `type App` from index.ts for Eden Treaty client generation

## New Feature Checklist

1. Create module directory under `src/modules/{feature}/`
2. Define service class with business logic — pass `workspaceId` to all queries
3. Define Elysia controller with routes — call `verifyAppOwnership` or `verifyStoreOwnership`
4. Register controller in `src/index.ts` under `/api` group
5. Write tests in `src/test/` — use `authRequest()` for workspace A, test isolation with `authRequestB()`
6. Include workspace isolation tests (workspace B cannot access workspace A resources)
7. Run `bun test` and `bunx biome check --write .`

## Ports

- Backend: 3001
- PostgreSQL: 5441

## Environment

Copy `.env.example` to `.env` for local development. All config is validated at startup via ArkType.
