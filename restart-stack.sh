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
if ! sudo docker ps -a | grep -q " postgres$"; then
  echo "🐘 Starting fresh Postgres container..."
  sudo docker run -d \
    --name postgres \
    --network ${PROJECT_NAME}_plural-net \
    -v ${PROJECT_NAME}_postgres_data:/var/lib/postgresql/data \
    --env-file ./.env \
    -e POSTGRES_DB=plural_db \
    -e POSTGRES_USER=synapse \
    postgres:15
else
  sudo docker start postgres 2>/dev/null || true
fi

# 1.5 Ensure plural_db exists
echo "🐘 Ensuring plural_db exists..."
sudo docker exec postgres psql -U synapse -tc "SELECT 1 FROM pg_database WHERE datname = 'plural_db'" | grep -q 1 || \
sudo docker exec postgres psql -U synapse -c "CREATE DATABASE plural_db"

# 2. Ensure Synapse is running
echo "🌌 Refreshing Synapse container..."
sudo docker rm -f plural-synapse 2>/dev/null || true
# Fix permissions just in case
sudo chown -R 991:991 synapse/config 2>/dev/null || true
sudo docker run -d \
  --name plural-synapse \
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
sudo docker rm -f plural-pantalaimon 2>/dev/null || true
sudo docker run -d \
  --name plural-pantalaimon \
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
echo "🗑️ Removing old plural-app-service container..."
sudo docker rm -f plural-app-service 2>/dev/null || true

# 5. Start new container
echo "🏃 Starting new plural-app-service container..."
sudo docker run -d \
  --name plural-app-service \
  --network ${PROJECT_NAME}_plural-net \
  --env-file ./.env \
  -v "$(pwd)/synapse/config/app-service-registration.yaml:/data/app-service-registration.yaml" \
  -e SYNAPSE_URL="http://plural-synapse:8008" \
  -p 9000:9000 \
  ${PROJECT_NAME}_app-service

# 6. Check status
echo "📊 Current Status:"
sudo docker ps --filter "name=plural-" --filter "name=postgres"

echo "✅ Done! Services are initializing. App service will auto-sync DB schema."
