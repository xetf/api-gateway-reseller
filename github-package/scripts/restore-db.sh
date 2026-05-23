#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

backup_file="${1:-}"

if [ -z "$backup_file" ]; then
  echo "Usage: bash scripts/restore-db.sh backups/<file>.dump" >&2
  exit 1
fi

if [ ! -f "$backup_file" ]; then
  echo "Backup file not found: $backup_file" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo ".env not found. Run deploy.sh first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

echo "This will restore database data from: $backup_file"
read -r -p "Type RESTORE to continue: " confirm

if [ "$confirm" != "RESTORE" ]; then
  echo "Restore cancelled."
  exit 0
fi

if command -v pg_restore >/dev/null 2>&1; then
  pg_restore "$backup_file" --dbname "$DATABASE_URL" --clean --if-exists --no-owner
elif command -v docker >/dev/null 2>&1 && docker compose ps postgres >/dev/null 2>&1; then
  cat "$backup_file" | docker compose exec -T postgres pg_restore -U gateway -d api_gateway --clean --if-exists --no-owner
else
  echo "pg_restore or Docker Compose is required for restore." >&2
  exit 1
fi

echo "Restore completed."
