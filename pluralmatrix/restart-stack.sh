#!/bin/bash

# PluralMatrix Restart Helper Script
# This script handles the manual rebuild and restart of the stack
# due to Docker Compose 'ContainerConfig' bugs.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 Starting PluralMatrix Stack Refresh..."

# 0. Ensure Network exists
sudo docker network create pluralmatrix_plural-net 2>/dev/null || true

# 1. Ensure Postgres is running
if ! sudo docker ps -a | grep -q " postgres$"; then
  echo "🐘 Starting fresh Postgres container..."
  sudo docker run -d \
    --name postgres \
    --network pluralmatrix_plural-net \
    -v pluralmatrix_postgres_data:/var/lib/postgresql/data \
    --env-file ../.env \
    -e POSTGRES_DB=plural_db \
    -e POSTGRES_USER=synapse \
    postgres:15
else
  sudo docker start postgres 2>/dev/null || true
fi

# 2. Ensure Synapse is running
if ! sudo docker ps -a | grep -q " plural-synapse$"; then
  echo "🌌 Starting fresh Synapse container..."
  # Fix permissions just in case
  sudo chown -R 991:991 synapse/config 2>/dev/null || true
  sudo docker run -d \
    --name plural-synapse \
    --network pluralmatrix_plural-net \
    -v "$(pwd)/synapse/config:/data" \
    -v "$(pwd)/synapse/modules:/modules" \
    --env-file ../.env \
    -e SYNAPSE_SERVER_NAME=localhost \
    -e SYNAPSE_REPORT_STATS=no \
    -e PYTHONPATH=/modules \
    -p 8008:8008 \
    matrixdotorg/synapse:latest
else
  sudo docker restart plural-synapse
fi

# 3. Rebuild the App Service Image
echo "📦 Rebuilding App Service image..."
sudo docker build -t pluralmatrix_app-service ./app-service

# 4. Remove old container
echo "🗑️ Removing old plural-app-service container..."
sudo docker rm -f plural-app-service 2>/dev/null || true

# 5. Start new container
echo "🏃 Starting new plural-app-service container..."
sudo docker run -d \
  --name plural-app-service \
  --network pluralmatrix_plural-net \
  --env-file ../.env \
  -v "$(pwd)/synapse/config/app-service-registration.yaml:/data/app-service-registration.yaml" \
  -e SYNAPSE_URL="http://plural-synapse:8008" \
  -p 9000:9000 \
  pluralmatrix_app-service

# 6. Check status
echo "📊 Current Status:"
sudo docker ps --filter "name=plural-" --filter "name=postgres"

echo "✅ Done! Services are initializing. App service will auto-sync DB schema."
