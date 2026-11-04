# AppBoard MCP Server

An [MCP](https://modelcontextprotocol.io) server that exposes the AppBoard ASO
REST API as tools, so AI agents (Claude Code, Cursor, Codex) can drive App Store
Optimization operations: list apps, edit and translate listings, generate ASO
content, score keywords (popularity / difficulty / opportunity), manage reviews
and purchases, and publish to the stores.

It speaks **STDIO** transport and talks to a running AppBoard backend over HTTP,
authenticating with a per-workspace API key.

## 1. Create an API key

The MCP server authenticates as a workspace using a bearer API key. Mint one from
an authenticated session (the token is shown **once**):

```bash
curl -X POST http://localhost:6680/api/auth/api-keys \
  -H "Content-Type: application/json" \
  --cookie "<your session cookie>" \
  -d '{ "name": "mcp-server" }'
# => { "id": "...", "name": "mcp-server", "prefix": "ab_xxxxxx", "token": "ab_..." }
```

Copy the `token` value (it starts with `ab_`). You can also create and revoke
keys from the admin panel.

## 2. Configure the environment

| Variable           | Required | Default                  | Description                          |
| ------------------ | -------- | ------------------------ | ------------------------------------ |
| `APPBOARD_API_KEY` | yes      | —                        | Bearer API key (`ab_...`)            |
| `APPBOARD_API_URL` | no       | `http://localhost:6680`  | Base URL of the running backend      |

```bash
export APPBOARD_API_KEY="ab_your_token_here"
export APPBOARD_API_URL="http://localhost:6680"
```

The server **fails fast** with a clear error if `APPBOARD_API_KEY` is missing.

### Remote (production) backend

The MCP server runs locally over STDIO, but it can drive any reachable
backend. To work against the hosted instance, mint the key against production
(`POST https://api.appboard.dev/api/auth/api-keys` with your panel session
cookie, as in step 1) and point the URL at it:

```bash
export APPBOARD_API_KEY="ab_your_production_token"
export APPBOARD_API_URL="https://api.appboard.dev"
bun run mcp:server
```

Every call is then scoped to the workspace that owns the key. Treat the key
like a password: anything the panel can do in that workspace, the key can do.

## 3. Run it

```bash
bun run mcp:server
```

## 4. Wire it into an MCP client

### Claude Code / Cursor (`mcp.json` / `claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "appboard": {
      "command": "bun",
      "args": ["run", "mcp:server"],
      "cwd": "/absolute/path/to/appboard_backend",
      "env": {
        "APPBOARD_API_KEY": "ab_your_token_here",
        "APPBOARD_API_URL": "http://localhost:6680"
      }
    }
  }
}
```

`cwd` must point at the backend directory so the `mcp:server` script resolves.
For the hosted backend use `"APPBOARD_API_URL": "https://api.appboard.dev"`.

## Exposed tools

| Tool                             | What it does                                                      |
| -------------------------------- | ---------------------------------------------------------------- |
| `apps_list`                      | List apps in the workspace (filter by platform / store)          |
| `apps_get`                       | Get one app by UUID                                              |
| `listings_list`                  | List all localized listings for an app                          |
| `listings_update_draft`          | Update a language's draft listing (auto-saved locally)          |
| `listings_translate_from`        | Translate all fields from a source language (respects Do Not Translate) |
| `ai_suggest_keywords`            | Suggest ASO keywords with AI                                    |
| `ai_translate_localization`      | Translate localization fields with ASO context                  |
| `ai_generate_release_notes`      | Generate release notes (What's New)                             |
| `ai_generate_listing_field`      | Generate / rephrase a single listing field                      |
| `reviews_list`                   | List reviews (filter by rating, language, reply, store)         |
| `reviews_reply`                  | Reply to a review                                               |
| `research_keyword_scores`        | Score keywords: popularity, difficulty + tiers, opportunity, classification, download estimates |
| `purchases_list`                 | List in-app purchases for an app                                |
| `publishing_validate_screenshot` | Validate a screenshot's dimensions for a display type           |
| `publishing_publish`             | Publish pending changes to the store (optionally submit for review) |
| `stores_import_app`              | Add an app from a public store link (no credentials); `devices` marks Apple TV / Android TV |
| `apps_update_devices`            | Set the form factors of an app record (`phone`, `tablet`, `tv`) |
| `tracking_get_markets`           | Per-market rank overview: tracked / ranked / top 10 / top 50, median and average position, movement, failed lookups, last check |
| `tracking_get_board`             | Tracker board for one market (positions, scores, movement, metadata gaps) |
| `tracking_get_by_version`        | Positions of one market per store version (last / best per keyword, change vs previous version, listing text per version) |
| `tracking_add_keywords`          | Track keywords in many markets in one call (`items: [{ country, keywords[] }]`) |
| `tracking_star_keywords`         | Star / unstar tracked keywords as the team's own targets (`items: [{ country, keywords[] }]`, `starred`) |
| `tracking_remove_keyword`        | Stop tracking a keyword (by `keywordId` or `country` + `keyword`) |
| `tracking_run_check`             | Start a background rank check (throttled per store) |
| `tracking_check_status`          | Status / progress / failures of the latest or a given rank check |
| `tracking_update_config`         | Rank tracking, auto-research, digest email settings |
| `research_runs_list`             | Saved research runs for an app |
| `research_run_start`             | Run research for an app in one country and save it |
| `store_performance_get`          | Google Play store listing acquisitions / visitors / conversion per month by traffic source, search term, campaign and country, from the Play bulk reports bucket |

All operations are scoped to the workspace the API key belongs to.

## Rank tracking at scale (example)

Loading hundreds of phrases across dozens of markets and measuring them:

1. `stores_import_app` with the store link (add `devices: ["tv"]` for an
   Android TV package, or `devices: ["phone", "tv"]` for an iOS app that also
   ships on Apple TV).
2. `tracking_add_keywords` with one item per market. Each market holds at most
   80 keywords; anything over the cap comes back under `rejected`.
3. `tracking_update_config` with `rankTrackingEnabled: true` (checks at 00:00
   and 12:00 server time).
4. `tracking_run_check`, then poll `tracking_check_status` until `status` is
   `completed`. Lookups are spaced about 3.5 s apart on the App Store and 1.5 s
   on Google Play, so 700 App Store keywords take roughly 40 minutes. When a
   store answers 403/429 the check slows that store down and pauses it for
   5 minutes, so a throttled run takes longer instead of failing. A lookup
   the store refuses (403/429/5xx after retries) is listed under `failures`
   and is never recorded as "not ranked".
5. `tracking_get_markets` for the overview, `tracking_get_board` per country.

Apple TV: Apple publishes no tvOS search results. An App Store record that
only serves Apple TV cannot be rank-tracked (`rankTracking.supported: false`);
one that also serves iPhone is measured in iPhone search.
