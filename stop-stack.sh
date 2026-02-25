#!/bin/bash

# PluralMatrix Stop Helper Script 🛑

# Load configuration from .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

PROJECT_NAME=${PROJECT_NAME:-pluralmatrix}

echo "🌌 Stopping $PROJECT_NAME Stack..."

# Gracefully stop the containers
sudo docker stop ${PROJECT_NAME}-app-service ${PROJECT_NAME}-synapse ${PROJECT_NAME}-postgres

echo "✅ All services stopped. Data remains safe in Docker volumes."
