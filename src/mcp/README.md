# AppBoard MCP Server

An [MCP](https://modelcontextprotocol.io) server that exposes the AppBoard ASO
REST API as tools, so AI agents (Claude Code, Cursor, Codex) can drive App Store
Optimization operations: list apps, edit and translate listings, generate ASO
content, manage reviews and purchases, and publish to the stores.

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
| `purchases_list`                 | List in-app purchases for an app                                |
| `publishing_validate_screenshot` | Validate a screenshot's dimensions for a display type           |
| `publishing_publish`             | Publish pending changes to the store (optionally submit for review) |

All operations are scoped to the workspace the API key belongs to.
