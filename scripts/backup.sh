#!/usr/bin/env bash
# Backs up MongoDB and the uploaded documents of the running production stack.
#   scripts/backup.sh [backup-dir]        (default ./backups, keeps the newest $KEEP sets, default 14)
# A backup you have never restored is a hope, not a backup: practise scripts/restore.sh on a spare machine.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.prod.yml)
DIR="${1:-backups}"; KEEP="${KEEP:-14}"; TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DIR"; umask 077

echo "Dumping MongoDB..."
"${COMPOSE[@]}" exec -T mongo mongodump --db steelprocure --archive --gzip > "$DIR/mongo-$TS.archive.gz.part"
echo "Archiving uploaded documents..."
"${COMPOSE[@]}" exec -T backend tar czf - -C /app uploads > "$DIR/uploads-$TS.tar.gz.part"

# Only a complete, non-empty file gets its final name.
for f in "mongo-$TS.archive.gz" "uploads-$TS.tar.gz"; do
  [ -s "$DIR/$f.part" ] || { echo "ERROR: $f is empty, backup failed" >&2; rm -f "$DIR/$f.part"; exit 1; }
  mv "$DIR/$f.part" "$DIR/$f"
done
echo "Backup complete: $DIR/mongo-$TS.archive.gz and $DIR/uploads-$TS.tar.gz"

# Retention: drop everything but the newest $KEEP sets of each kind.
for pattern in 'mongo-*.archive.gz' 'uploads-*.tar.gz'; do
  ls -1t "$DIR"/$pattern 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f --
done
echo "These files contain confidential business data: store them encrypted and off this machine."
