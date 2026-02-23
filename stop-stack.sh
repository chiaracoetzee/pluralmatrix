#!/bin/bash

# PluralMatrix Stop Helper Script 🛑
PROJECT_NAME="pluralmatrix" # Updated by setup.sh

echo "🌌 Stopping $PROJECT_NAME Stack..."

# Gracefully stop the containers
sudo docker stop ${PROJECT_NAME}_app-service ${PROJECT_NAME}_pantalaimon ${PROJECT_NAME}_synapse ${PROJECT_NAME}_postgres

echo "✅ All services stopped. Data remains safe in Docker volumes."
