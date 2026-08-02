#!/usr/bin/env python3
"""
Fetch Jira Issues — Data source script for GeneratorAI automations.
Outputs JSON array of Jira issues to stdout.

Environment Variables:
  JIRA_URL       Required. Jira server URL (e.g., https://jira.company.com)
  JIRA_EMAIL     Required. Jira account email for authentication
  JIRA_TOKEN     Required. Jira API token
  JIRA_PROJECT   Required. Project key (e.g., PROJ)
  JIRA_JQL       Optional. Additional JQL filter (default: "type != Sub-task")
  JIRA_MAX       Optional. Max results (default: 200)
"""
import sys
import os
import json

try:
    import requests
except ImportError:
    print("Error: 'requests' library required. Install with: pip install requests", file=sys.stderr)
    sys.exit(1)

def print_help():
    print(__doc__, file=sys.stderr)

if "--help" in sys.argv or "-h" in sys.argv:
    print_help()
    sys.exit(0)

jira_url = os.getenv("JIRA_URL", "").strip()
jira_email = os.getenv("JIRA_EMAIL", "").strip()
jira_token = os.getenv("JIRA_TOKEN", "").strip()
jira_project = os.getenv("JIRA_PROJECT", "").strip()
jira_jql = os.getenv("JIRA_JQL", "type != Sub-task").strip()
jira_max = int(os.getenv("JIRA_MAX", "200"))

if not all([jira_url, jira_email, jira_token, jira_project]):
    print("Error: Missing required env vars: JIRA_URL, JIRA_EMAIL, JIRA_TOKEN, JIRA_PROJECT", file=sys.stderr)
    print_help()
    sys.exit(1)

try:
    jql = f'project = {jira_project} AND {jira_jql} ORDER BY created DESC'
    url = f"{jira_url.rstrip('/')}/rest/api/3/search"

    response = requests.get(
        url,
        params={"jql": jql, "fields": "key,summary,issuetype,priority,assignee,status", "maxResults": jira_max},
        auth=(jira_email, jira_token),
        headers={"Accept": "application/json"},
        timeout=30,
    )

    if response.status_code != 200:
        print(f"Error: Jira API returned {response.status_code}: {response.text[:500]}", file=sys.stderr)
        sys.exit(1)

    data = response.json()
    issues = []
    for issue in data.get("issues", []):
        f = issue.get("fields", {})
        issues.append({
            "key": issue.get("key"),
            "summary": f.get("summary"),
            "type": (f.get("issuetype") or {}).get("name"),
            "priority": (f.get("priority") or {}).get("name"),
            "status": (f.get("status") or {}).get("name"),
            "assignee": (f.get("assignee") or {}).get("displayName", "Unassigned"),
        })

    print(json.dumps(issues))

except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
