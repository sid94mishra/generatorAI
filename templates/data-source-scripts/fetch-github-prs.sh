#!/bin/bash
#
# Fetch GitHub PRs — Data source script for GeneratorAI automations.
# Outputs JSON array of PRs to stdout using the 'gh' CLI.
#
# Environment Variables:
#   GH_REPO    Required. Repository in 'owner/repo' format
#   GH_STATE   Optional. PR state: open, closed, all (default: open)
#   GH_LABEL   Optional. Filter by label
#   GH_LIMIT   Optional. Max results (default: 100)
#

set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    sed -n '2,12p' "$0" >&2
    exit 0
fi

GH_REPO="${GH_REPO:-}"
GH_STATE="${GH_STATE:-open}"
GH_LABEL="${GH_LABEL:-}"
GH_LIMIT="${GH_LIMIT:-100}"

if [[ -z "$GH_REPO" ]]; then
    echo "Error: Missing required env var: GH_REPO (e.g., owner/repo)" >&2
    exit 1
fi

if ! command -v gh &>/dev/null; then
    echo "Error: 'gh' CLI is not installed. Install from https://cli.github.com/" >&2
    exit 1
fi

ARGS=(--repo "$GH_REPO" --state "$GH_STATE" --limit "$GH_LIMIT" --json number,title,url,author,headRefName,labels)

if [[ -n "$GH_LABEL" ]]; then
    ARGS+=(--label "$GH_LABEL")
fi

gh pr list "${ARGS[@]}" 2>/dev/null | jq 'map({
    number: .number,
    title: .title,
    url: .url,
    author: .author.login,
    branch: .headRefName,
    labels: ([.labels[].name] | join(","))
})'
