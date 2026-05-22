#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

MODE="install"
SKIP_DOCKER="false"

for arg in "$@"; do
  case "$arg" in
    --update)
      MODE="update"
      ;;
    --skip-docker)
      SKIP_DOCKER="true"
      ;;
    -h|--help)
      cat <<'USAGE'
Usage:
  bash deploy.sh            First deployment or idempotent redeploy
  bash deploy.sh --update   Pull-safe rebuild/migrate/restart flow
  bash deploy.sh --skip-docker  Do not start bundled Postgres/Redis
USAGE
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      exit 1
      ;;
  esac
done

log() {
  printf '\n\033[1;32m==>\033[0m %s\n' "$1"
}

warn() {
  printf '\033[1;33mWarning:\033[0m %s\n' "$1"
}

die() {
  printf '\033[1;31mError:\033[0m %s\n' "$1" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

random_secret() {
  if command_exists openssl; then
    openssl rand -base64 32 | tr -d '\n'
  else
    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  fi
}

random_hex() {
  local bytes="${1:-16}"
  if command_exists openssl; then
    openssl rand -hex "$bytes" | tr -d '\n'
  else
    node -e "console.log(require('crypto').randomBytes(Number(process.argv[1])).toString('hex'))" "$bytes"
  fi
}

read_with_default() {
  local prompt="$1"
  local default_value="$2"
  local value

  read -r -p "$prompt [$default_value]: " value || true
  printf '%s' "${value:-$default_value}"
}

require_node() {
  command_exists node || die "Node.js 20+ is required. Install Node first, then rerun deploy.sh."
  command_exists npm || die "npm is required. Install npm first, then rerun deploy.sh."

  local major
  major="$(node -p "Number(process.versions.node.split('.')[0])")"
  if [ "$major" -lt 20 ]; then
    die "Node.js 20+ is required. Current version: $(node -v)"
  fi
}

require_docker() {
  if [ "$SKIP_DOCKER" = "true" ]; then
    return
  fi

  command_exists docker || die "Docker is required for bundled Postgres/Redis. Install Docker or use --skip-docker."
  docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is required. Install it or use --skip-docker."
}

ensure_pm2() {
  if command_exists pm2; then
    return
  fi

  log "Installing PM2"
  npm install -g pm2
}

write_env_file() {
  if [ -f .env ]; then
    log ".env already exists; keeping it"
    return
  fi

  log "Creating .env"
  local postgres_password jwt_secret admin_email admin_username admin_password api_port web_port api_base web_base

  postgres_password="$(random_hex 16)"
  jwt_secret="$(random_secret)"

  admin_email="$(read_with_default "Admin email" "admin@example.com")"
  admin_username="$(read_with_default "Admin username" "admin")"
  admin_password="$(read_with_default "Admin password" "$(random_hex 8)")"
  api_port="$(read_with_default "API port" "4100")"
  web_port="$(read_with_default "Web port" "4101")"
  api_base="$(read_with_default "Public API base URL" "http://127.0.0.1:${api_port}")"
  web_base="$api_base"

  cat > .env <<ENV
POSTGRES_PASSWORD="${postgres_password}"
DATABASE_URL="postgresql://gateway:${postgres_password}@127.0.0.1:55432/api_gateway?schema=public"
REDIS_URL="redis://127.0.0.1:56379"

API_PORT=${api_port}
API_HOST="0.0.0.0"
PUBLIC_API_BASE_URL="${api_base}"
CORS_ORIGINS="http://127.0.0.1:${web_port},http://localhost:${web_port}"

WEB_PORT=${web_port}
NEXT_PUBLIC_API_BASE_URL="${web_base}"

JWT_SECRET="${jwt_secret}"
ADMIN_EMAIL="${admin_email}"
ADMIN_USERNAME="${admin_username}"
ADMIN_PASSWORD="${admin_password}"

UPSTREAM_BASE_URL="https://api.openai.com"
UPSTREAM_API_KEY=""
UPSTREAM_TIMEOUT_MS=120000
MODEL_POOL_HEALTH_INTERVAL_SECONDS=30

DEFAULT_CURRENCY="USD"
ENV

  chmod 600 .env
  printf '\nAdmin login:\n  username: %s\n  email: %s\n  password: %s\n' "$admin_username" "$admin_email" "$admin_password"
}

load_env() {
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
}

start_infra() {
  if [ "$SKIP_DOCKER" = "true" ]; then
    warn "Skipping Docker services. Make sure DATABASE_URL and REDIS_URL point to running services."
    return
  fi

  log "Starting Postgres and Redis"
  docker compose --env-file .env up -d postgres redis
}

wait_for_postgres() {
  if [ "$SKIP_DOCKER" = "true" ]; then
    return
  fi

  log "Waiting for Postgres"
  for _ in $(seq 1 60); do
    if docker compose exec -T postgres pg_isready -U gateway -d api_gateway >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done

  die "Postgres did not become ready in time."
}

install_dependencies() {
  log "Installing npm dependencies"
  npm install
}

build_and_migrate() {
  log "Generating Prisma client"
  npm run db:generate

  log "Applying database migrations"
  npm run db:migrate:deploy

  log "Seeding blank deployment data"
  npm run db:seed

  log "Building API and web"
  npm run build
}

start_pm2() {
  log "Starting PM2 apps"
  PROJECT_ROOT="$PROJECT_ROOT" pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save
}

print_summary() {
  local web_port api_port admin_username admin_email
  web_port="${WEB_PORT:-4101}"
  api_port="${API_PORT:-4100}"
  admin_username="${ADMIN_USERNAME:-admin}"
  admin_email="${ADMIN_EMAIL:-admin@example.com}"

  cat <<SUMMARY

Deployment complete.

Web:
  http://SERVER_IP:${web_port}

API:
  http://SERVER_IP:${api_port}

Admin login:
  username: ${admin_username}
  email: ${admin_email}

Useful commands:
  pm2 status
  pm2 logs api-gateway-api
  pm2 logs api-gateway-web
  bash deploy.sh --update

Next step:
  Log in to the admin panel, add upstream providers, add model prices, then create model pools.
SUMMARY
}

main() {
  log "Checking runtime"
  require_node
  require_docker
  ensure_pm2

  write_env_file
  load_env
  start_infra
  wait_for_postgres
  install_dependencies
  build_and_migrate
  start_pm2
  print_summary
}

main
