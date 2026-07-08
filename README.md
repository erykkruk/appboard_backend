# AppBoard Backend

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/erykkruk/appboard-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/erykkruk/appboard-backend/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3-black.svg)](https://bun.sh/)

> Open-source ASO (App Store Optimization) management backend — connect App Store Connect & Google Play, sync metadata, manage listings, screenshots, reviews, and publish via one API.

AppBoard Backend is a self-hosted REST API that lets you manage your mobile apps across **App Store Connect** and **Google Play Console** from a single place. It powers the [AppBoard Admin Panel](https://github.com/erykkruk/appboard-admin) but can also be used standalone.

---

## Features

- **Store connections** — connect App Store Connect (App Store API key) and Google Play (service account JSON) with encrypted credential storage (AES-256-GCM)
- **App management** — sync apps from connected stores, group multiple apps under projects
- **Listings editor** — manage localized metadata (title, subtitle, description, keywords, promotional text) per language
- **Screenshots & assets** — upload, crop, reorder screenshots and app icons; sync to stores
- **Reviews inbox** — fetch user reviews and manage replies
- **Publishing pipeline** — create new versions, manage localizations, submit builds for review
- **AI assistance** — translate listings, generate descriptions, suggest keywords, monetization chat (powered by OpenRouter)
- **History & rollback** — GitHub-style version history per field with one-click rollback
- **Feature flags** — workspace-scoped toggles for 12 modules with dependency cascade
- **Multi-tenancy** — every endpoint is workspace-scoped; tenants are fully isolated
- **Reviews, age rating, privacy declarations, in-app purchases** — comprehensive store metadata coverage

---

## Architecture

```
┌──────────────────┐    HTTP    ┌──────────────────┐
│  AppBoard Admin  │───────────▶│  AppBoard Backend │
│   (Next.js 16)   │            │   (Elysia/Bun)    │
└──────────────────┘            └────────┬─────────┘
                                         │
                       ┌─────────────────┼──────────────────┐
                       │                 │                  │
                       ▼                 ▼                  ▼
                ┌─────────────┐  ┌─────────────┐   ┌─────────────┐
                │ PostgreSQL  │  │ App Store   │   │ Google Play │
                │             │  │ Connect API │   │   Console   │
                └─────────────┘  └─────────────┘   └─────────────┘
```

The backend follows a **feature-based modular architecture** under `src/modules/{feature}/`. Each module ships its own controller, service, types, and tests. Shared utilities live in `src/utils/`.

See the companion [AppBoard Admin Panel](https://github.com/erykkruk/appboard-admin) for the UI.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) `>= 1.3`
- [PostgreSQL](https://www.postgresql.org/) `>= 18` (or use the bundled `docker-compose.yml`)
- (Optional) App Store Connect API key — for App Store integration
- (Optional) Google Play service account JSON — for Google Play integration
- (Optional) OpenRouter API key — for AI features

### 1. Clone & install

```bash
git clone https://github.com/erykkruk/appboard-backend.git
cd appboard-backend
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set required values. See [Configuration](#configuration) below.

Generate a strong `ENCRYPTION_KEY` (32-byte hex):

```bash
openssl rand -hex 32
```

### 3. Start PostgreSQL

```bash
bun run db:up   # uses docker-compose
```

### 4. Migrations

Migrations apply automatically when the server boots — a fresh install needs no
manual step. (After changing the schema, generate a new migration with
`bun run db:generate`.)

### 5. Start the server

```bash
bun run dev
```

The API is now available at `http://localhost:6680`. OpenAPI/Swagger docs are at `http://localhost:6680/openapi`.

```bash
curl http://localhost:6680/api/system/health
# { "status": "ok" }
```

---

## Configuration

All configuration is loaded from environment variables and validated with [ArkType](https://arktype.io/) at startup. The server refuses to boot with invalid config.

| Variable | Required | Description |
|---|---|---|
| `DB_URL` | ✅ | PostgreSQL connection string |
| `PORT` | | HTTP port (default `6680`) |
| `ALLOWED_ORIGINS` | | Comma-separated CORS origins |
| `ENCRYPTION_KEY` | ✅ | 64-char hex (32 bytes) for AES-256-GCM credential encryption — generate with `openssl rand -hex 32` |
| `BETTER_AUTH_SECRET` | ✅ | Min. 32 chars, used by Better Auth for session signing |
| `BETTER_AUTH_URL` | ✅ | Public base URL of the backend |
| `NODE_ENV` | | `development` or `production` |
| `SEED_USER_EMAIL` / `SEED_USER_NAME` | | Optional owner to create via `bun run db:seed` |
| `ENABLE_TEST_AUTH` | | Dev/test only: enables the `X-Test-User-Id` auth bypass. Never honored in production |
| `OPENROUTER_API_KEY` | | Required for AI features |
| `OPENROUTER_URL` | | OpenRouter chat completions endpoint |
| `OPENROUTER_MODEL` | | Default AI model |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | | OTP email delivery. Leave empty in **development** for the fixed dev OTP `123456`. **In production the server refuses to boot without SMTP** (so there is no fixed-OTP login in prod). |

---

## API Modules

| Module | Prefix | Description |
|---|---|---|
| System | `/api/system` | Health check, bootstrap |
| Auth | `/api/auth/*` | Better Auth handlers (sign-in, OTP, sessions) |
| Features | `/api/features` | Per-workspace feature flags |
| Stores | `/api/stores` | Store connections (App Store, Google Play) |
| Apps | `/api/apps` | App management & sync |
| App Groups | `/api/app-groups` | Group apps under projects |
| Listings | `/api/apps/:id/listings` | Localized metadata |
| Assets | `/api/apps/:id/assets` | Screenshots, icons |
| Publishing | `/api/apps/:id/publishing` | Versions, localizations, submit for review |
| Reviews | `/api/apps/:id/reviews` | User reviews & replies |
| History | `/api/apps/:id/history` | Listing change history & rollback |
| Age Rating | `/api/apps/:id/age-rating` | Age rating questionnaires |
| Privacy | `/api/apps/:id/privacy` | Privacy declarations |
| Purchases | `/api/apps/:id/purchases` | In-app purchases & subscriptions |
| ASO Profile | `/api/apps/:id/aso-profile` | ASO research and profiles |
| AI | `/api/ai` | Translation, generation, chat |
| Settings | `/api/settings` | Workspace settings |

Full OpenAPI spec is auto-generated and served at `/openapi`.

---

## Development

```bash
bun run dev                     # dev server with watch mode
bun test                        # run unit + integration tests
bunx biome check --write .      # lint + format
bunx tsc --noEmit               # type check
bun run db:generate             # generate Drizzle migrations
```

### Project Structure

```
src/
├── config/         # ArkType-validated env config + auth setup
├── modules/        # Feature modules (controller + service + tests)
├── providers/      # External providers (App Store Connect, Google Play)
├── utils/          # DB client, errors, crypto, logger
└── test/           # Cross-module integration tests
```

### Tech Stack

| Category | Technology | Version |
|---|---|---|
| Runtime | [Bun](https://bun.sh/) | 1.3.x |
| Framework | [Elysia](https://elysiajs.com/) | 1.4.x |
| Database | [PostgreSQL](https://www.postgresql.org/) | 18 |
| ORM | [Drizzle ORM](https://orm.drizzle.team/) | 0.45.x |
| Auth | [Better Auth](https://better-auth.com/) | 1.4.x |
| Validation | [ArkType](https://arktype.io/) | 2.1.x |
| Linter | [Biome](https://biomejs.dev/) | 2.3.x |
| Logger | [Pino](https://getpino.io/) | 10.x |

---

## Roadmap

> Best-effort roadmap, no committed timeline.

- [ ] Real-time review/listing sync via webhooks
- [ ] Google Play listing publishing parity with App Store
- [ ] Asset publishing pipeline for both stores
- [ ] App Previews (video) support
- [ ] Rate limiting on public endpoints
- [ ] Multi-user roles within a workspace

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and the PR process.

By contributing you agree that your contributions will be licensed under the MIT License.

---

## Security

Found a security issue? Please **do not** open a public issue. See [SECURITY.md](SECURITY.md) for responsible disclosure.

---

## License

MIT © 2026 [Eryk Kruk](https://github.com/erykkruk)

See [LICENSE](LICENSE) for the full text.
