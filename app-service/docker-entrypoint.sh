#!/bin/sh
set -e

echo "⏳ Waiting for database to be ready..."
# Use a simple loop to wait for postgres
until npx prisma db pull > /dev/null 2>&1; do
  echo "📡 Postgres is unavailable - sleeping"
  sleep 2
done

echo "🚀 Database is up! Syncing schema..."
npx prisma db push --accept-data-loss

echo "🏁 Starting PluralMatrix App Service..."
exec node dist/index.js
