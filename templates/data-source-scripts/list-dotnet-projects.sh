#!/bin/bash
#
# List .NET Projects — Data source script for GeneratorAI automations.
# Outputs JSON array of .NET projects from a solution file.
#
# Environment Variables:
#   SOLUTION_PATH   Required. Path to .sln file or directory containing one
#

set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    sed -n '2,8p' "$0" >&2
    exit 0
fi

SOLUTION_PATH="${SOLUTION_PATH:-}"

if [[ -z "$SOLUTION_PATH" ]]; then
    echo "Error: Missing required env var: SOLUTION_PATH" >&2
    exit 1
fi

if [[ -f "$SOLUTION_PATH" ]]; then
    SLN_FILE="$SOLUTION_PATH"
elif [[ -d "$SOLUTION_PATH" ]]; then
    SLN_FILE=$(find "$SOLUTION_PATH" -maxdepth 1 -name "*.sln" -print -quit)
    if [[ -z "$SLN_FILE" ]]; then
        echo "Error: No .sln file found in $SOLUTION_PATH" >&2
        exit 1
    fi
else
    echo "Error: Path does not exist: $SOLUTION_PATH" >&2
    exit 1
fi

if ! command -v dotnet &>/dev/null; then
    echo "Error: 'dotnet' CLI is not installed" >&2
    exit 1
fi

SLN_DIR=$(dirname "$(realpath "$SLN_FILE")")
PROJECTS=$(dotnet sln "$SLN_FILE" list 2>/dev/null | tail -n +3 | grep -E '\.csproj$' || true)

if [[ -z "$PROJECTS" ]]; then
    echo "[]"
    exit 0
fi

RESULT="[]"
while IFS= read -r proj; do
    [[ -z "$proj" ]] && continue
    FULL="$SLN_DIR/$proj"
    NAME=$(basename "$proj" .csproj)
    FW=$(grep -oP '<TargetFramework>\K[^<]+' "$FULL" 2>/dev/null | head -1 || echo "unknown")

    ENTRY=$(jq -n --arg n "$NAME" --arg p "$proj" --arg f "$FW" '{name:$n,path:$p,framework:$f}')
    RESULT=$(echo "$RESULT" | jq ". += [$ENTRY]")
done <<< "$PROJECTS"

echo "$RESULT"
