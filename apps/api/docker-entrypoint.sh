#!/bin/sh
# Docker entrypoint for LMPdf API production
# Fix uploads volume ownership (Docker named volumes default to root:root)
# then drop privileges to appuser before starting the app.

chown -R appuser:appgroup /app/apps/api/uploads 2>/dev/null

exec su-exec appuser node dist/main.js