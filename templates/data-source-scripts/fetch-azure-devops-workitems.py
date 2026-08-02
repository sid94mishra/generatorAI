#!/usr/bin/env python3
"""
Fetch Azure DevOps Work Items — Data source script for GeneratorAI automations.
Fetches work items via WIQL query and outputs JSON array to stdout.

Environment Variables:
  ADO_ORG      Required. Azure DevOps organization name
  ADO_PROJECT  Required. Project name
  ADO_TOKEN    Required. Personal Access Token (PAT)
  ADO_QUERY    Required. WIQL query (e.g., "SELECT [System.Id] FROM WorkItems WHERE ...")

WIQL Examples:
  SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Bug' AND [System.State] = 'Active'
  SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me
"""
import sys
import os
import json
from base64 import b64encode

try:
    import requests
except ImportError:
    print("Error: 'requests' library required. Install with: pip install requests", file=sys.stderr)
    sys.exit(1)

if "--help" in sys.argv or "-h" in sys.argv:
    print(__doc__, file=sys.stderr)
    sys.exit(0)

ado_org = os.getenv("ADO_ORG", "").strip()
ado_project = os.getenv("ADO_PROJECT", "").strip()
ado_token = os.getenv("ADO_TOKEN", "").strip()
ado_query = os.getenv("ADO_QUERY", "").strip()

if not all([ado_org, ado_project, ado_token, ado_query]):
    print("Error: Missing required env vars: ADO_ORG, ADO_PROJECT, ADO_TOKEN, ADO_QUERY", file=sys.stderr)
    sys.exit(1)

try:
    auth = b64encode(f":{ado_token}".encode()).decode()
    headers = {"Authorization": f"Basic {auth}", "Content-Type": "application/json"}
    base = f"https://dev.azure.com/{ado_org}/{ado_project}/_apis"

    # Step 1: Execute WIQL
    r = requests.post(f"{base}/wit/wiql?api-version=7.0", json={"query": ado_query}, headers=headers, timeout=30)
    if r.status_code != 200:
        print(f"Error: WIQL failed {r.status_code}: {r.text[:500]}", file=sys.stderr)
        sys.exit(1)

    ids = [item["id"] for item in r.json().get("workItems", [])]
    if not ids:
        print(json.dumps([]))
        sys.exit(0)

    # Step 2: Fetch details in batches of 200
    items = []
    for i in range(0, len(ids), 200):
        batch = ids[i:i+200]
        r2 = requests.get(
            f"{base}/wit/workitems?ids={','.join(map(str, batch))}&fields=System.Id,System.Title,System.WorkItemType,System.State,System.AssignedTo&api-version=7.0",
            headers=headers, timeout=30,
        )
        if r2.status_code != 200:
            print(f"Error: Fetch items failed {r2.status_code}: {r2.text[:500]}", file=sys.stderr)
            sys.exit(1)

        for wi in r2.json().get("value", []):
            f = wi.get("fields", {})
            items.append({
                "id": wi.get("id"),
                "title": f.get("System.Title"),
                "type": f.get("System.WorkItemType"),
                "state": f.get("System.State"),
                "assignedTo": (f.get("System.AssignedTo") or {}).get("displayName", "Unassigned"),
            })

    print(json.dumps(items))

except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
