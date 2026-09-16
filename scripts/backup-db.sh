#!/usr/bin/env bash
# Daily Postgres backup with a rolling retention window.
#
# Cron (as the app's deploy user, not root):
#   0 3 * * * /path/to/backend/scripts/backup-db.sh >> /var/log/mechanic-movil-backup.log 2>&1
#
# Requires DATABASE_URL and, optionally, BACKUP_DIR / BACKUP_RETENTION_DAYS
# in the environment (or in a .env file — see below).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL must be set (directly or via .env)}"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/../../backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

# Prisma's DATABASE_URL carries a ?schema=... query param it understands
# but pg_dump's own URI parser doesn't — strip any query string before
# handing the URL to pg_dump.
PG_DUMP_URL="${DATABASE_URL%%\?*}"

mkdir -p "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
out_file="$BACKUP_DIR/mechanic_movil-$timestamp.sql.gz"
tmp_file="$out_file.tmp"

echo "[$(date -Iseconds)] starting backup -> $out_file"
pg_dump "$PG_DUMP_URL" | gzip > "$tmp_file"
mv "$tmp_file" "$out_file"
echo "[$(date -Iseconds)] backup complete ($(du -h "$out_file" | cut -f1))"

# Prune anything older than the retention window.
find "$BACKUP_DIR" -name 'mechanic_movil-*.sql.gz' -mtime "+$RETENTION_DAYS" -print -delete

echo "[$(date -Iseconds)] retained backups:"
ls -la "$BACKUP_DIR"
