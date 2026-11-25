#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh into the running production stack. DESTRUCTIVE: replaces current data.
#   scripts/restore.sh backups/mongo-<ts>.archive.gz [backups/uploads-<ts>.tar.gz]
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.prod.yml)
MONGO_FILE="${1:?Usage: restore.sh <mongo-archive.gz> [uploads.tar.gz]}"; UPLOADS_FILE="${2:-}"
[ -s "$MONGO_FILE" ] || { echo "Not found or empty: $MONGO_FILE" >&2; exit 1; }
[ -z "$UPLOADS_FILE" ] || [ -s "$UPLOADS_FILE" ] || { echo "Not found or empty: $UPLOADS_FILE" >&2; exit 1; }

echo "This REPLACES the steelprocure database${UPLOADS_FILE:+ and the uploaded documents} in the running stack."
read -r -p "Type RESTORE to continue: " answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

echo "Stopping the API so nothing writes during the restore..."
"${COMPOSE[@]}" stop backend frontend
"${COMPOSE[@]}" exec -T mongo mongorestore --archive --gzip --drop --nsInclude 'steelprocure.*' < "$MONGO_FILE"
if [ -n "$UPLOADS_FILE" ]; then
  "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint sh backend -c 'rm -rf /app/uploads/* && tar xzf - -C /app' < "$UPLOADS_FILE"
fi
"${COMPOSE[@]}" up -d backend frontend
echo "Restore finished. Check /health and open a document to confirm."
