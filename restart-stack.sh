#!/bin/bash

# PluralMatrix Restart Helper Script 🚀
# This script is a wrapper around docker-compose that handles 
# critical pre-flight tasks (permissions, SQL setup) that 
# standard compose cannot handle easily.

# Load configuration from .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

PROJECT_NAME=${PROJECT_NAME:-pluralmatrix}
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 Starting $PROJECT_NAME Stack Refresh via Docker Compose..."

# 0. Cleanup: Remove existing containers if they conflict
# This ensures docker-compose can take full ownership of the naming
echo "🗑️ Cleaning up conflicting containers..."
sudo docker rm -f ${PROJECT_NAME}-postgres ${PROJECT_NAME}-synapse ${PROJECT_NAME}-app-service 2>/dev/null || true

# 1. Pre-flight: Fix Synapse Permissions
# Synapse runs as a specific user (default 991) and needs write access to its config dir
echo "🛡️ Fixing Synapse permissions..."
S_UID=${SYNAPSE_UID:-991}
S_GID=${SYNAPSE_GID:-991}
sudo chown -R $S_UID:$S_GID synapse/config 2>/dev/null || true

# 2. Start Postgres first
echo "🐘 Starting database..."
sudo docker-compose up -d postgres

# 3. Wait for Postgres to be ready
echo "🐘 Waiting for Postgres to be ready..."
until sudo docker exec ${PROJECT_NAME}-postgres pg_isready -U synapse -d template1 >/dev/null 2>&1; do
  echo -n "."
  sleep 1
done
until sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d template1 -c "SELECT 1" >/dev/null 2>&1; do
  echo -n "o"
  sleep 1
done
echo " Ready!"

# 4. SQL Setup: Ensure plural_db and restricted user exist
# This is required for the App Service to use a restricted account
echo "🐘 Ensuring plural_db and plural_app user exist..."
PG_PASS=$(grep POSTGRES_PASSWORD .env | cut -d '=' -f2)

sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d template1 -tc "SELECT 1 FROM pg_database WHERE datname = 'plural_db'" | grep -q 1 || \
sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d template1 -c "CREATE DATABASE plural_db"

sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d template1 -c "DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'plural_app') THEN
        CREATE USER plural_app WITH PASSWORD '$PG_PASS';
    ELSE
        ALTER USER plural_app WITH PASSWORD '$PG_PASS';
    END IF;
END \$\$;"
sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d plural_db -c "GRANT ALL PRIVILEGES ON DATABASE plural_db TO plural_app;"
sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d plural_db -c "ALTER SCHEMA public OWNER TO plural_app;"
sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d plural_db -c "GRANT ALL ON SCHEMA public TO plural_app;"

# 5. Bring up the rest of the stack
echo "📦 Building and starting services..."
# We use --build to ensure code changes are caught
sudo docker-compose up -d --build synapse app-service

# 6. Wait for Synapse to be healthy
echo "🌌 Waiting for Synapse to be ready..."
until curl -s http://localhost:8008/_matrix/static/ >/dev/null 2>&1; do
  echo -n "."
  sleep 2
done
echo " Ready!"

# 7. Final status
echo "📊 Current Status:"
sudo docker-compose ps

echo "✅ Done! Services are initializing. App service will auto-sync DB schema."
