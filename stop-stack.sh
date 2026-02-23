#!/bin/bash

# PluralMatrix Stop Helper Script 🛑
echo "🌌 Stopping PluralMatrix Stack..."

# Gracefully stop the containers
# This preserves all data in Docker volumes
sudo docker stop plural-app-service plural-pantalaimon plural-synapse postgres

echo "✅ All services stopped. Data remains safe in Docker volumes."
