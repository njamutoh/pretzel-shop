#!/bin/sh
set -e

echo "Running database migrations..."
node scripts/migrate.js

echo "Starting server..."
exec node server.js
