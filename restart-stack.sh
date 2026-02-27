#!/bin/bash

# PluralMatrix Restart Helper Script 🚀
# This script handles the manual rebuild and restart of the stack.

# Load configuration from .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

PROJECT_NAME=${PROJECT_NAME:-pluralmatrix}
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 Starting $PROJECT_NAME Stack Refresh..."

# 0. Ensure Network exists
sudo docker network create ${PROJECT_NAME}-plural-net 2>/dev/null || true

# 1. Ensure Postgres is running
if ! sudo docker ps -a | grep -q " ${PROJECT_NAME}-postgres$"; then
  echo "🐘 Starting fresh Postgres container..."
  sudo docker run -d \
    --name ${PROJECT_NAME}-postgres \
    -v ${PROJECT_NAME}-postgres-data:/var/lib/postgresql/data \
    --env-file ./.env \
    -e POSTGRES_DB=plural_db \
    -e POSTGRES_USER=synapse \
    postgres:15
else
  sudo docker start ${PROJECT_NAME}-postgres 2>/dev/null || true
fi

# Always ensure it is connected to the current network instance
sudo docker network connect ${PROJECT_NAME}-plural-net ${PROJECT_NAME}-postgres 2>/dev/null || true

# Wait for Postgres to be ready
echo "🐘 Waiting for Postgres to be ready..."
# First wait for pg_isready to pass
until sudo docker exec ${PROJECT_NAME}-postgres pg_isready -U synapse -d template1 >/dev/null 2>&1; do
  echo -n "."
  sleep 1
done

# Then wait for a successful connection to ensure it's not in the middle of an init shutdown
until sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d template1 -c "SELECT 1" >/dev/null 2>&1; do
  echo -n "o"
  sleep 1
done
echo " Ready!"

# 1.5 Ensure plural_db and restricted user exist
echo "🐘 Ensuring plural_db and plural_app user exist..."
# Get password from .env
PG_PASS=$(grep POSTGRES_PASSWORD .env | cut -d '=' -f2)

# Create DB if missing (though POSTGRES_DB should handle it on first boot)
sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d template1 -tc "SELECT 1 FROM pg_database WHERE datname = 'plural_db'" | grep -q 1 || \
sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d template1 -c "CREATE DATABASE plural_db"

# Create Restricted User if missing and Grant Privileges
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


# 2. Ensure Synapse is running
echo "🌌 Refreshing Synapse container..."
sudo docker rm -f ${PROJECT_NAME}-synapse 2>/dev/null || true
# Fix permissions just in case
sudo chown -R 991:991 synapse/config 2>/dev/null || true
sudo docker run -d \
  --name ${PROJECT_NAME}-synapse \
  --network ${PROJECT_NAME}-plural-net \
  -v "$(pwd)/synapse/config:/data" \
  -v "$(pwd)/synapse/modules:/modules" \
  --env-file ./.env \
  -e SYNAPSE_SERVER_NAME=localhost \
  -e SYNAPSE_REPORT_STATS=no \
  -e PYTHONPATH=/modules \
  -p 8008:8008 \
  matrixdotorg/synapse:latest

# Wait for Synapse to be ready
echo "🌌 Waiting for Synapse to be ready..."
until curl -s http://localhost:8008/_matrix/static/ >/dev/null 2>&1; do
  echo -n "."
  sleep 2
done
echo " Ready!"

# 3. Rebuild the App Service Image
echo "📦 Rebuilding App Service image..."
sudo docker build -t ${PROJECT_NAME}-app-service -f ./app-service/Dockerfile .

# 4. Remove old container
echo "🗑️ Removing old ${PROJECT_NAME}-app-service container..."
sudo docker rm -f ${PROJECT_NAME}-app-service 2>/dev/null || true

# 5. Start new container
echo "🏃 Starting new ${PROJECT_NAME}-app-service container..."
sudo docker run -d \
  --name ${PROJECT_NAME}-app-service \
  --network ${PROJECT_NAME}-plural-net \
  --env-file ./.env \
  -e PROJECT_NAME="${PROJECT_NAME}" \
  -v "$(pwd)/synapse/config/app-service-registration.yaml:/data/app-service-registration.yaml" \
  -v "${PROJECT_NAME}-app-service-data:/app/data" \
  -e SYNAPSE_URL="http://${PROJECT_NAME}-synapse:8008" \
  -p 9000:9000 \
  ${PROJECT_NAME}-app-service

# 6. Check status
echo "📊 Current Status:"
sudo docker ps --filter "name=${PROJECT_NAME}-"

echo "✅ Done! Services are initializing. App service will auto-sync DB schema."
