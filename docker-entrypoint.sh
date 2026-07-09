#!/bin/sh
set -e

# Zero-config self-hosting: auto-generate a persistent ENCRYPTION_KEY when none
# is provided. The backend validates ENCRYPTION_KEY against ^[0-9a-fA-F]{64}$,
# so the generated value MUST be exactly 64 lowercase hex chars (32 bytes).
if [ -z "${ENCRYPTION_KEY:-}" ]; then
  KEY_FILE="${ENCRYPTION_KEY_FILE:-/app/data/encryption.key}"

  if [ ! -f "$KEY_FILE" ]; then
    mkdir -p "$(dirname "$KEY_FILE")"
    bun -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > "$KEY_FILE"
    echo "[entrypoint] No ENCRYPTION_KEY provided; generated a new persistent key at $KEY_FILE"
  fi

  export ENCRYPTION_KEY="$(cat "$KEY_FILE")"
fi

exec "$@"
