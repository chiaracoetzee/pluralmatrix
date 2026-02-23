#!/bin/bash

# PluralMatrix Stop Helper Script 🛑
PROJECT_NAME="pluralmatrix" # Updated by setup.sh

echo "🌌 Stopping $PROJECT_NAME Stack..."

# Gracefully stop the containers
sudo docker stop ${PROJECT_NAME}-app-service ${PROJECT_NAME}-pantalaimon ${PROJECT_NAME}-synapse ${PROJECT_NAME}-postgres

echo "✅ All services stopped. Data remains safe in Docker volumes."
