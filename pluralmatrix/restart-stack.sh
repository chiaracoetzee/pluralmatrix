#!/bin/bash

# PluralMatrix Restart Helper Script
# This script handles the manual rebuild and restart of the stack
# due to Docker Compose 'ContainerConfig' bugs.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 Starting PluralMatrix Stack Refresh..."

# 1. Rebuild the App Service Image
echo "📦 Rebuilding App Service image..."
sudo docker build -t pluralmatrix_app-service ./app-service

# 2. Remove old container
echo "🗑️ Removing old plural-app-service container..."
sudo docker rm -f plural-app-service 2>/dev/null || true

# 3. Start new container
echo "🏃 Starting new plural-app-service container..."
sudo docker run -d \
  --name plural-app-service \
  --network pluralmatrix_plural-net \
  --env-file ../.env \
  -v "$(pwd)/synapse/config/app-service-registration.yaml:/data/app-service-registration.yaml" \
  -e SYNAPSE_URL="http://plural-synapse:8008" \
  -p 9000:9000 \
  pluralmatrix_app-service

# 4. Restart Synapse (to refresh module)
echo "🔄 Restarting plural-synapse..."
sudo docker restart plural-synapse

# 5. Check status
echo "📊 Current Status:"
sudo docker ps --filter "name=plural-"

echo "✅ Done! Synapse may take ~20 seconds to fully boot."
