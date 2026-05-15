# Security Policy

## Supported Versions

AppBoard Backend is under active development. Only the latest minor release is supported with security fixes.

| Version | Supported          |
| ------- | ------------------ |
| `0.5.x` | :white_check_mark: |
| `< 0.5` | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Instead, report them privately via GitHub's [private vulnerability reporting](https://github.com/erykkruk/appboard-backend/security/advisories/new) for this repository.

When reporting, please include as much of the following information as possible:

- Type of issue (e.g. authentication bypass, SQL injection, SSRF, credential exposure, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

This information will help us triage your report more quickly.

## Disclosure Process

1. You submit a private vulnerability report
2. We acknowledge receipt within **72 hours**
3. We investigate and confirm the vulnerability
4. We develop and test a fix
5. We release the fix and publish an advisory
6. We credit you in the advisory (unless you prefer to remain anonymous)

We aim to resolve confirmed vulnerabilities within **90 days** of the initial report.

## Security Best Practices for Self-Hosting

If you self-host AppBoard Backend, please follow these guidelines:

- **Generate a unique `ENCRYPTION_KEY`** — never reuse the example value from `.env.example`. Use `openssl rand -hex 32`.
- **Generate a unique `BETTER_AUTH_SECRET`** — at least 32 characters. Use `openssl rand -base64 48`.
- **Restrict database access** — do not expose PostgreSQL to the public internet.
- **Use HTTPS in production** — terminate TLS at a reverse proxy (nginx, Caddy, Traefik).
- **Restrict `ALLOWED_ORIGINS`** — only include the exact origins of your admin panel.
- **Rotate credentials** — especially App Store Connect API keys and Google Play service accounts, per your org's policy.
- **Keep dependencies up to date** — watch releases and apply updates promptly.
- **Monitor logs** — AppBoard uses [Pino](https://getpino.io/) for structured logging.

## Scope

This policy covers the code in this repository. Vulnerabilities in third-party dependencies should be reported to the respective upstream projects; however, if you believe AppBoard Backend is using a dependency in an unsafe way, please still report it here.
