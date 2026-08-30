# AppBoard CLI

A small command-line tool for the AppBoard API with two commands:

- `upload` - upload a folder of screenshots, the web-based equivalent of
  ButterKit's Fastlane-folder upload, built for **CI pipelines**. Every image is
  validated against its display type's accepted dimensions **before** upload, so
  a wrong-sized asset fails fast with a clear message (expected vs. provided
  dimensions) instead of being silently distorted.
- `keywords` - score App Store keywords (popularity, difficulty, opportunity,
  classification, download estimates) straight in the terminal.

It reuses the same typed client and authentication as the [MCP server](../mcp/README.md):
the API key comes from `APPBOARD_API_KEY` and the base URL from `APPBOARD_API_URL`.

## 1. Create an API key

The CLI authenticates as a workspace using a bearer API key (`ab_...`). Mint one
from an authenticated session (the token is shown **once**) or from the admin
panel:

```bash
curl -X POST http://localhost:6680/api/auth/api-keys \
  -H "Content-Type: application/json" \
  --cookie "<your session cookie>" \
  -d '{ "name": "ci-screenshots" }'
# => { "id": "...", "name": "ci-screenshots", "prefix": "ab_xxxxxx", "token": "ab_..." }
```

## 2. Environment

| Variable           | Required | Default                 | Description                     |
| ------------------ | -------- | ----------------------- | ------------------------------- |
| `APPBOARD_API_KEY` | yes      | —                       | Bearer API key (`ab_...`)       |
| `APPBOARD_API_URL` | no       | `http://localhost:6680` | Base URL of the running backend |

The CLI **fails fast** with a clear error if `APPBOARD_API_KEY` is missing.

## 3. Run it

From the backend directory:

```bash
bun run cli upload --app <appId> --lang <locale> --platform <apple|gp> \
  --display-type <type> ./screenshots
```

Or via the `appboard` bin (e.g. after `bun link` / `bunx`):

```bash
appboard upload --app <appId> --lang en-US --platform apple \
  --display-type APP_IPHONE_67 ./screenshots
```

Show usage:

```bash
bun run cli --help
```

## The `upload` command

```
appboard upload --app <appId> --lang <locale> --platform <apple|gp> \
  --display-type <type> [--version <versionId>] [--api-url <url>] <dir>
```

| Option            | Required | Description                                                                          |
| ----------------- | -------- | ------------------------------------------------------------------------------------ |
| `<dir>`           | yes      | Directory of screenshots (`.png`/`.jpg`/`.jpeg`)                                      |
| `--app`           | yes      | App UUID                                                                              |
| `--lang`          | yes      | Listing locale, e.g. `en-US`                                                          |
| `--platform`      | yes      | `apple` (App Store) or `gp` (Google Play)                                             |
| `--display-type`  | yes      | Display type the screenshots target (see below)                                      |
| `--version`       | no       | Version to upload into. Defaults to the first editable version (Apple) / `"default"` (Google Play) |
| `--api-url`       | no       | Backend base URL; overrides `APPBOARD_API_URL`                                        |
| `-h`, `--help`    | no       | Show usage                                                                            |

**Behavior**

1. Scans `<dir>` for `.png`/`.jpg`/`.jpeg`, sorted by filename (sort order
   becomes the store display order).
2. For each file: **validates** dimensions against the display type. If invalid,
   prints the expected vs. provided dimensions plus a suggestion and marks the
   file as failed (it is not uploaded).
3. If valid, uploads via the screenshots upload endpoint.
4. Prints a per-file `✓` / `✗` summary.
5. Exits `0` only if **all** files succeeded; otherwise `1`.

## The `keywords` command

```
appboard keywords --country <cc> [--track-id <id>] [--json] \
  [--api-url <url>] <keyword>[, <keyword>...]
```

| Option         | Required | Description                                                       |
| -------------- | -------- | ----------------------------------------------------------------- |
| `<keyword>...` | yes      | Up to 10 keywords, comma-separated or as separate arguments       |
| `--country`    | yes      | Two-letter App Store country code, e.g. `us`, `pl`                |
| `--track-id`   | no       | App Store track id of your app - the table adds its rank per keyword |
| `--json`       | no       | Print the full JSON response (breakdown, tiers, all 20 positions) |
| `--api-url`    | no       | Backend base URL; overrides `APPBOARD_API_URL`                    |

Example:

```bash
appboard keywords --country us --track-id 324684580 "fitness tracker, habit tracker"
```

```
Keyword scores (US, downloads/day at #1 as low-high):

KEYWORD                  POP  DIFF  LABEL      OPP  CLASS             DL/DAY #1     RANK
fitness tracker          72   68    hard       41   high-competition  69-276        #12
habit tracker            58   45    moderate   55   good-target       14-57         -
```

The scoring endpoint is `POST /api/research/keyword-scores` (RESEARCH feature
flag). Popularity is calibrated to Apple's 1-100 scale; difficulty corrects for
Apple's search backfill and detects brand keywords. Exits `0` only when every
keyword scored; a partial failure (per-keyword `error`) exits `1`.

## Valid display types

The accepted dimensions per display type are defined by the API (`REQUIRED_SIZES`):

**Apple (App Store)**

| Display type        | Device              | Accepted sizes (W×H, either orientation) |
| ------------------- | ------------------- | ---------------------------------------- |
| `APP_IPHONE_35`     | iPhone 3.5"         | 640×1136, 640×1096                        |
| `APP_IPHONE_40`     | iPhone 4.0"         | 640×1136                                  |
| `APP_IPHONE_47`     | iPhone 4.7"         | 750×1334                                  |
| `APP_IPHONE_55`     | iPhone 5.5"         | 1242×2208                                 |
| `APP_IPHONE_58`     | iPhone 5.8"         | 1125×2436                                 |
| `APP_IPHONE_61`     | iPhone 6.1"         | 828×1792, 1284×2778                       |
| `APP_IPHONE_65`     | iPhone 6.5"         | 1242×2688, 1284×2778                      |
| `APP_IPHONE_67`     | iPhone 6.7"         | 1290×2796                                 |
| `APP_IPAD_PRO_129`  | iPad Pro 12.9"      | 2064×2752, 2048×2732                      |

**Google (Google Play)**

| Display type | Device           | Accepted sizes (W×H, either orientation) |
| ------------ | ---------------- | ---------------------------------------- |
| `phone`      | Android phone    | 1284×2778, 1242×2688                      |
| `sevenInch`  | Android 7" tablet | 2048×2732, 2064×2752                     |
| `tenInch`    | Android 10" tablet | 2048×2732, 2064×2752                    |

(Each accepts both portrait and landscape variants of the listed sizes.)

## GitHub Actions

Upload a screenshots directory from CI — the Fastlane-folder equivalent. Store
the API key as a repository secret (`APPBOARD_API_KEY`) and the backend URL as a
variable or secret.

```yaml
name: Upload screenshots

on:
  push:
    branches: [main]

jobs:
  upload-screenshots:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Upload App Store screenshots
        env:
          APPBOARD_API_KEY: ${{ secrets.APPBOARD_API_KEY }}
          APPBOARD_API_URL: ${{ vars.APPBOARD_API_URL }}
        run: |
          bun run cli upload \
            --app ${{ vars.APPBOARD_APP_ID }} \
            --lang en-US \
            --platform apple \
            --display-type APP_IPHONE_67 \
            ./fastlane/screenshots/en-US
```

The step exits non-zero if any screenshot has the wrong dimensions or fails to
upload, failing the job.
