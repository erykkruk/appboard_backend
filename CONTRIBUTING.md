# Contributing to AppBoard Backend

Thanks for your interest in contributing to AppBoard! This is the backend API
(TypeScript, Bun, Elysia, Drizzle, PostgreSQL) for the source-available,
self-hostable ASO (App Store Optimization) tool. Contributions of all kinds are
welcome — bug fixes, features, docs, and tests.

AppBoard is **source-available and free for personal & non-commercial use under
the [PolyForm Noncommercial License 1.0.0](LICENSE)**. Note that this is **not**
an OSI-approved open-source license — it restricts commercial use. By
contributing, you agree that your contributions will be licensed under the same
PolyForm Noncommercial License 1.0.0.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating, you are expected to uphold it. Please report unacceptable
behavior to conduct@appboard.dev.

## Prerequisites

- [Bun](https://bun.sh/) `>= 1.3`
- [PostgreSQL](https://www.postgresql.org/) `>= 18` (or use the bundled `docker-compose.yml` via `bun run db:up`)
- Docker (optional, for the bundled PostgreSQL container)

## Local Setup

```bash
# 1. Fork and clone the repo, then:
bun install

# 2. Create your local env file and adjust values as needed
cp .env.example .env
# Generate a strong ENCRYPTION_KEY (32-byte hex):
#   openssl rand -hex 32

# 3. Start PostgreSQL (docker-compose)
bun run db:up

# 4. Start the dev server (watch mode)
bun run dev
```

The API runs at `http://localhost:6680`. OpenAPI/Swagger docs are at
`http://localhost:6680/openapi`. Migrations apply automatically on boot.

After changing the Drizzle schema, generate a migration:

```bash
bun run db:generate
```

## Before You Open a PR

Run the full local check suite and make sure everything passes:

```bash
bunx biome check --write .   # lint + format
bunx tsc --noEmit            # type check
bun test                     # unit + integration tests
```

- Add or update tests for any behavior you change. Tests must run authenticated
  (see the workspace-scoping notes in `CLAUDE.md`).
- Keep changes focused — one logical change per PR.

## Branch Model

- **`develop`** is the integration branch. Base your work on it and open PRs
  **into `develop`**.
- **`main`** is the released/deployed branch. Do not target it directly.

```bash
git checkout develop
git pull
git checkout -b feat/my-change
```

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add keyword rank tracking endpoint
fix: correct workspace scoping on listings query
chore: bump drizzle to 0.45.1
docs: clarify env setup
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`.

## Pull Requests

1. Ensure lint, type check, and tests pass locally.
2. Push your branch and open a PR **targeting `develop`**.
3. Fill out the PR template (Summary, Changes, Related issue, Testing, Checklist).
4. Use a Conventional Commits style PR title.

### Review Expectations

- Every PR requires review and approval before it can be merged — direct pushes
  to `develop`/`main` are not accepted.
- A maintainer will review for correctness, workspace scoping/security, test
  coverage, and adherence to the conventions in `CLAUDE.md`.
- Be responsive to review feedback; keep the discussion constructive.

## Security

Please do not report security vulnerabilities via public issues. See
[SECURITY.md](SECURITY.md) for responsible disclosure.
