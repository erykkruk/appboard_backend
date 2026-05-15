# AppBoard Backend

Backend API for **AppBoard** — an ASO (App Store Optimization) management tool for App Store Connect and Google Play Console.

## Tech Stack

| Category | Technology |
|----------|-----------|
| Runtime | Bun |
| Framework | ElysiaJS |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Validation | ArkType |
| Linter | Biome |
| Logger | Pino |

## Getting Started

```bash
# Install dependencies
bun install

# Start PostgreSQL
bun run db:up

# Run migrations
bun run db:generate

# Start dev server (port 3001)
bun run dev
```

## Scripts

| Command | Description |
|---------|------------|
| `bun run dev` | Start dev server with watch mode |
| `bun run start` | Start production server |
| `bun test` | Run tests |
| `bun run db:up` | Start PostgreSQL container |
| `bun run db:generate` | Generate Drizzle migrations |
| `bunx biome check --write .` | Lint and format |

## API Modules

| Module | Prefix | Description |
|--------|--------|-------------|
| System | `/api/system` | Health check, bootstrap |
| Stores | `/api/stores` | Store connections (App Store, Google Play) |
| Apps | `/api/apps` | App management, sync |
| Listings | `/api/apps/:appId/listings` | Localized metadata (title, description, keywords) |
| Assets | `/api/apps/:appId/assets` | Screenshots, icons |
| Reviews | `/api/apps/:appId/reviews` | Review management, replies |
| Publishing | `/api/apps/:appId/publishing` | Version management, localizations, screenshots, submit for review |
| AI | `/api/ai` | Translation, description generation, keyword suggestions |
| Settings | `/api/settings` | App configuration |
| History | `/api/apps/:appId/history` | Listing change history, rollback |

## Environment

Copy `.env.example` to `.env`. All config is validated at startup via ArkType.

## TODO

- [ ] **Languages tab — delete localization**: ASC API `DELETE appStoreVersionLocalizations/{id}` returns errors for primary language and certain states. Implement proper deletion with error handling and enable the Remove button in the frontend (currently disabled with tooltip "only available via App Store Connect").
- [ ] **Real API providers**: Replace demo/mock data with actual App Store Connect and Google Play API calls for store sync.
- [ ] **Listing publishing for Google Play**: Implement Google Play listing push (currently only App Store publishing works).
- [ ] **Asset publishing**: Push local asset changes to store APIs.
- [ ] **Webhook / real-time sync**: Auto-sync store data on external changes instead of manual sync.
- [ ] **Auth**: Add user authentication and multi-user support.
- [ ] **Rate limiting**: Add rate limiting to API endpoints.
