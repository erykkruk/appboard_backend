# Contributing to AppBoard Backend

First off — thanks for taking the time to contribute! 🎉

This document describes how to set up a development environment, our code style, and the pull request process.

---

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

---

## Ways to Contribute

- **Report bugs** — open an issue using the bug report template
- **Request features** — open an issue using the feature request template
- **Improve docs** — README, inline docs, examples
- **Fix bugs / implement features** — see below

---

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) `>= 1.3`
- Docker & Docker Compose (for PostgreSQL)

### Setup

```bash
git clone https://github.com/erykkruk/appboard-backend.git
cd appboard-backend
bun install
cp .env.example .env
bun run db:up
bun run db:generate
bun run dev
```

The server listens on `http://localhost:6680`.

---

## Project Structure

```
src/
├── config/         # ArkType-validated env config + auth setup
├── modules/        # Feature modules (controller + service + tests)
│   └── {feature}/
│       ├── index.ts              # Elysia controller
│       ├── {feature}.service.ts  # Business logic
│       ├── {feature}.types.ts    # Feature-specific types
│       └── {feature}.test.ts     # Tests
├── providers/      # External providers (App Store Connect, Google Play)
├── utils/          # DB client, errors, crypto, logger
└── test/           # Cross-module integration tests
```

### Adding a New Module

1. Create `src/modules/{feature}/` with `index.ts`, `{feature}.service.ts`, `{feature}.types.ts`, `{feature}.test.ts`
2. Define a service class holding business logic — **pass `workspaceId` to every DB query**
3. Define an Elysia controller with routes — call `verifyAppOwnership` / `verifyStoreOwnership` where applicable
4. Register the controller in `src/index.ts` under the `/api` group
5. Write tests — use `authRequest()` (workspace A) and `authRequestB()` (workspace B) from `src/test/setup.ts`
6. Include at least one **workspace isolation test** (workspace B must never see workspace A resources)

---

## Code Style

- **Linter / formatter:** [Biome](https://biomejs.dev/) — run `bunx biome check --write .` before committing
- **Naming:**
  - Files: `kebab-case.ts` or `dot.notation.ts` (e.g. `db.service.ts`)
  - Classes: `PascalCase`
  - Functions/variables: `camelCase`
  - Constants: `SCREAMING_SNAKE_CASE`
  - DB tables: `snake_case` (handled by Drizzle casing config)
- **Imports:** use `@/` path alias instead of deep relative imports
- **No `any`** — use `unknown` + narrowing, or a precise type
- **No `console.log`** — use `createLogger()` from `@/utils/logger`
- **No raw `throw new Error`** — use `buildError()` from `@/utils/errors`
- **No raw SQL** — use Drizzle ORM; for credential storage use `encrypt()`/`decrypt()` from `@/utils/crypto`

---

## Testing

All tests run with `bun test`. We use the built-in Bun test runner.

```bash
bun test                            # all tests
bun test src/modules/apps           # only apps module
```

### Writing Tests

- **Always authenticate** via `authRequest()` (workspace A) — never hit endpoints unauthenticated
- Test **workspace isolation** using `authRequestB()` — verify workspace B cannot access workspace A resources
- Seed test data with helpers from `src/test/setup.ts`
- Follow **Arrange → Act → Assert** structure
- Prefer integration tests (full request lifecycle) over isolated unit tests for controllers

---

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`.

Examples:
```
feat(listings): add bulk translation endpoint
fix(auth): handle expired session cookies
chore(ci): upgrade Bun to 1.3.8
```

---

## Pull Request Process

1. **Fork** the repo and create a branch from `main`: `git checkout -b feat/my-feature`
2. **Make your changes** — keep commits focused and well-described
3. **Add tests** for any new logic or bug fix — new features without tests will be rejected
4. **Run the full quality gate** locally before opening a PR:
   ```bash
   bunx biome check --write .
   bunx tsc --noEmit
   bun test
   ```
5. **Update docs** if your change affects public behavior, config, or the API surface
6. **Open a PR** using the PR template — link any related issue
7. **Respond to review** — be open to feedback, we aim to be constructive

CI will run lint, type check, and tests. All checks must pass before a PR can be merged.

---

## Releases

Releases follow [Semantic Versioning](https://semver.org/). The maintainer tags releases and updates `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## Questions?

Open a [GitHub Discussion](https://github.com/erykkruk/appboard-backend/discussions) or a draft issue. We're happy to help.
