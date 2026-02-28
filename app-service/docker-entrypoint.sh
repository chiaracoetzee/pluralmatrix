#!/bin/sh
set -e

echo "⏳ Waiting for database to be ready and applying migrations..."
# prisma migrate deploy is safe to run repeatedly and works on an empty DB
until npx prisma migrate deploy > /dev/null 2>&1; do
  echo "📡 Postgres is unavailable or user lacks permissions - sleeping"
  sleep 2
done

echo "🚀 Database is up and schema is synced!"

echo "🏁 Starting PluralMatrix App Service..."
exec node dist/index.js
