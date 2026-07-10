# AppBoard — one-click deployment templates

Status wszystkich zgłoszeń marketplace/template (stan: 2026-07-10).

## Otwarte PR-y

| Serwis | PR | Pliki | Status | Obrazy |
|--------|----|-------|--------|--------|
| **Coolify** | [coollabsio/coolify#10885](https://github.com/coollabsio/coolify/pull/10885) | `templates/compose/appboard.yaml`, `public/svgs/appboard.svg` | OPEN — GitGuardian ✅, czeka na review | `:latest` |
| **Dokploy** | [Dokploy/templates#988](https://github.com/Dokploy/templates/pull/988) | `blueprints/appboard/*` (compose, meta, template.toml, logo, instrukcje) | OPEN — validate/build-preview ✅, czeka na review | `:latest` |
| **Easypanel** | [easypanel-io/templates#1477](https://github.com/easypanel-io/templates/pull/1477) | `templates/appboard/*` (index.ts, meta.yaml, logo, screenshot) | OPEN — deploy-preview ✅; review Ahson-Shaikh: smoke test + pinowane tagi + linki → **poprawione** (patrz niżej) | pinowane (`0.7.2` backend / `0.7.3` panel) |

### Feedback z review Easypanel i co z nim zrobiliśmy

1. **Smoke test padał** — backend startował przed Postgresem i crash-loopował na
   `CREATE SCHEMA "drizzle" → Connection closed`. Naprawione w backendzie
   `0.7.2`: `runMigrations()` rozpoznaje błędy połączenia i ponawia migracje
   do 30× co 2 s (zweryfikowane lokalnie: backend odpalony 15 s przed
   Postgresem wstaje bez restartu kontenera).
2. **"The latest tags has to go away"** — szablon Easypanel pinuje teraz
   `appboard-backend:0.7.2` + `appboard-web:0.7.3` (workflow publikuje tag
   wersji obok `latest`).
3. **Linki** — GitHub/Website zweryfikowane, dodany link Documentation →
   https://appboard.dev/docs.

## Fork-i, z których żyją PR-y

- Coolify: `erykkruk/coolify`, branch `add-appboard-template`
- Dokploy: `erykkruk/templates`, branch `add-appboard`
- Easypanel: `erykkruk/templates-1`, branch `add-appboard`

## Obrazy Docker (GHCR, publiczne)

- `ghcr.io/erykkruk/appboard-backend` i `ghcr.io/erykkruk/appboard-web`
- multi-arch (amd64 + arm64), budowane przez `.github/workflows/publish-image.yml`
  w każdym repo **na każdy push do `main`** + ręcznie (`workflow_dispatch`)
- tagi: `latest`, wersja z `package.json` (np. `0.7.2`), pełny SHA commita

## Bez PR-a (konfiguracja w naszym repo)

- **Render** — Blueprint `render.yaml` w rootcie backendu + sekcja Deploy w README
  (`BETTER_AUTH_URL`/`ALLOWED_ORIGINS` są `sync:false` — ustawić po deployu na URL panelu)
- **Docker Compose (self-host)** — `compose.selfhost.yaml` + `.env.selfhost.example`

## Do zrobienia ręcznie (wymagają konta właściciela)

- **Railway** — publikacja template'u z poziomu konta
- **Zeabur** — jw.
- **DigitalOcean Marketplace** — jw.
- **Heroku** — świadomie pominięty (model single-app nie pasuje do dwóch serwisów + Postgres)
