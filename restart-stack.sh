#!/bin/bash

# PluralMatrix Restart Helper Script 🚀
# This script handles the manual rebuild and restart of the stack.

PROJECT_NAME="pluralmatrix" # Updated by setup.sh
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 Starting $PROJECT_NAME Stack Refresh..."

# 0. Ensure Network exists
sudo docker network create ${PROJECT_NAME}_plural-net 2>/dev/null || true

# 1. Ensure Postgres is running
if ! sudo docker ps -a | grep -q " ${PROJECT_NAME}_postgres$"; then
  echo "🐘 Starting fresh Postgres container..."
  sudo docker run -d \
    --name ${PROJECT_NAME}_postgres \
    -v ${PROJECT_NAME}_postgres_data:/var/lib/postgresql/data \
    --env-file ./.env \
    -e POSTGRES_DB=plural_db \
    -e POSTGRES_USER=synapse \
    postgres:15
else
  sudo docker start ${PROJECT_NAME}_postgres 2>/dev/null || true
fi

# Always ensure it is connected to the current network instance
sudo docker network connect ${PROJECT_NAME}_plural-net ${PROJECT_NAME}_postgres 2>/dev/null || true

# Wait for Postgres to be ready
echo "🐘 Waiting for Postgres to be ready..."
until sudo docker exec ${PROJECT_NAME}_postgres pg_isready -U synapse >/dev/null 2>&1; do
  echo -n "."
  sleep 1
done
echo " Ready!"

# 1.5 Ensure plural_db and restricted user exist
echo "🐘 Ensuring plural_db and plural_app user exist..."
# Get password from .env
PG_PASS=$(grep POSTGRES_PASSWORD .env | cut -d '=' -f2)

# Create DB if missing
sudo docker exec ${PROJECT_NAME}_postgres psql -U synapse -d template1 -tc "SELECT 1 FROM pg_database WHERE datname = 'plural_db'" | grep -q 1 || \
sudo docker exec ${PROJECT_NAME}_postgres psql -U synapse -d template1 -c "CREATE DATABASE plural_db"

# Create Restricted User if missing and Grant Privileges
sudo docker exec ${PROJECT_NAME}_postgres psql -U synapse -d template1 -c "DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'plural_app') THEN
        CREATE USER plural_app WITH PASSWORD '$PG_PASS';
    END IF;
END \$\$;"
sudo docker exec ${PROJECT_NAME}_postgres psql -U synapse -d template1 -c "GRANT ALL PRIVILEGES ON DATABASE plural_db TO plural_app;"


# 2. Ensure Synapse is running
echo "🌌 Refreshing Synapse container..."
sudo docker rm -f ${PROJECT_NAME}_synapse 2>/dev/null || true
# Fix permissions just in case
sudo chown -R 991:991 synapse/config 2>/dev/null || true
sudo docker run -d \
  --name ${PROJECT_NAME}_synapse \
  --network ${PROJECT_NAME}_plural-net \
  -v "$(pwd)/synapse/config:/data" \
  -v "$(pwd)/synapse/modules:/modules" \
  --env-file ./.env \
  -e SYNAPSE_SERVER_NAME=localhost \
  -e SYNAPSE_REPORT_STATS=no \
  -e PYTHONPATH=/modules \
  -p 8008:8008 \
  matrixdotorg/synapse:latest

# 2.5 Ensure Pantalaimon is running
echo "🛡️ Refreshing Pantalaimon container..."
sudo docker rm -f ${PROJECT_NAME}_pantalaimon 2>/dev/null || true
sudo docker run -d \
  --name ${PROJECT_NAME}_pantalaimon \
  --network ${PROJECT_NAME}_plural-net \
  -p 8010:8010 \
  -v "$(pwd)/pantalaimon/pantalaimon.conf:/pantalaimon.conf" \
  -v ${PROJECT_NAME}_pantalaimon_data:/data \
  matrixdotorg/pantalaimon:latest \
  -c /pantalaimon.conf --data-path /data

# 3. Rebuild the App Service Image
echo "📦 Rebuilding App Service image..."
sudo docker build -t ${PROJECT_NAME}_app-service ./app-service

# 4. Remove old container
echo "🗑️ Removing old ${PROJECT_NAME}_app-service container..."
sudo docker rm -f ${PROJECT_NAME}_app-service 2>/dev/null || true

# 5. Start new container
echo "🏃 Starting new ${PROJECT_NAME}_app-service container..."
sudo docker run -d \
  --name ${PROJECT_NAME}_app-service \
  --network ${PROJECT_NAME}_plural-net \
  --env-file ./.env \
  -v "$(pwd)/synapse/config/app-service-registration.yaml:/data/app-service-registration.yaml" \
  -e SYNAPSE_URL="http://${PROJECT_NAME}_synapse:8008" \
  -p 9000:9000 \
  ${PROJECT_NAME}_app-service

# 6. Check status
echo "📊 Current Status:"
sudo docker ps --filter "name=${PROJECT_NAME}_"

echo "✅ Done! Services are initializing. App service will auto-sync DB schema."
