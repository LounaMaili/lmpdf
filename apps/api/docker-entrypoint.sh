#!/bin/sh
set -eu
# Docker entrypoint for LMPdf API production
# Prepare uploads and settings ownership (named volumes default to root:root)
# then drop privileges to appuser before starting the app.

chown -R appuser:appgroup /app/apps/api/uploads
mkdir -p /app/apps/api/config
chown -R appuser:appgroup /app/apps/api/config
chmod 700 /app/apps/api/config
if [ -f /app/apps/api/config/admin-settings.json ]; then
  chmod 600 /app/apps/api/config/admin-settings.json
fi

exec su-exec appuser "$@"
