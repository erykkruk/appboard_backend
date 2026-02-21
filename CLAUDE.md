# AppBoard Backend

## Overview
Backend API for AppBoard — an ASO (App Store Optimization) management tool. Manages store connections, app metadata, and listing optimization.
panel - /Users/erykkruk/Development/Github/Side-projects/appboard_web


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

## Anti-patterns

- NEVER use `console.log` — use `createLogger()` from `@/utils/logger`
- NEVER hardcode secrets — use config from `@/config`
- NEVER put business logic in controllers — use service classes
- NEVER use raw SQL — use Drizzle ORM
- NEVER store credentials unencrypted — use `encrypt()`/`decrypt()` from `@/utils/crypto`
- NEVER use `any` type

## Best Practices

- ALWAYS validate env config with ArkType schema in `@/config`
- ALWAYS use `@/` path aliases for imports
- ALWAYS format with `bunx biome check --write` before committing
- ALWAYS run `bun test` before committing
- ALWAYS use the pagination macro for list endpoints
- ALWAYS export `type App` from index.ts for Eden Treaty client generation

## New Feature Checklist

1. Create module directory under `src/modules/{feature}/`
2. Define service class with business logic
3. Define Elysia controller with routes
4. Register controller in `src/index.ts` under `/api` group
5. Write tests in `src/test/` or `src/modules/{feature}/`
6. Run `bun test` and `bunx biome check --write .`

## Ports

- Backend: 3001
- PostgreSQL: 5441

## Environment

Copy `.env.example` to `.env` for local development. All config is validated at startup via ArkType.
