#!/bin/bash
set -e
# Start Copilot CLI in headless server mode.
# Usage: docker sandbox exec <name> /usr/local/bin/sandbox-entrypoint.sh

PORT="${COPILOT_CLI_PORT:-4321}"
echo "[sandbox-entrypoint] Starting Copilot CLI in headless mode on port ${PORT}..."

if ! command -v copilot &> /dev/null; then
  echo "[ERROR] copilot command not found in PATH"
  exit 127
fi

exec copilot --headless --port "${PORT}"
