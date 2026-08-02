#!/usr/bin/env python3
"""
Fetch SonarQube Issues — Data source script for GeneratorAI automations.
Outputs JSON array of SonarQube issues to stdout.

Environment Variables:
  SONAR_URL       Required. SonarQube server URL
  SONAR_TOKEN     Required. SonarQube authentication token
  SONAR_PROJECT   Required. Project key
  SONAR_SEVERITY  Optional. Filter: BLOCKER,CRITICAL,MAJOR,MINOR,INFO (default: all)
  SONAR_MAX       Optional. Max results per page (default: 500)
"""
import sys
import os
import json

try:
    import requests
except ImportError:
    print("Error: 'requests' library required. Install with: pip install requests", file=sys.stderr)
    sys.exit(1)

if "--help" in sys.argv or "-h" in sys.argv:
    print(__doc__, file=sys.stderr)
    sys.exit(0)

sonar_url = os.getenv("SONAR_URL", "").strip()
sonar_token = os.getenv("SONAR_TOKEN", "").strip()
sonar_project = os.getenv("SONAR_PROJECT", "").strip()
sonar_severity = os.getenv("SONAR_SEVERITY", "").strip()
sonar_max = int(os.getenv("SONAR_MAX", "500"))

if not all([sonar_url, sonar_token, sonar_project]):
    print("Error: Missing required env vars: SONAR_URL, SONAR_TOKEN, SONAR_PROJECT", file=sys.stderr)
    sys.exit(1)

try:
    url = f"{sonar_url.rstrip('/')}/api/issues/search"
    params = {"componentKeys": sonar_project, "statuses": "OPEN", "ps": sonar_max}
    if sonar_severity:
        params["severities"] = sonar_severity

    response = requests.get(url, params=params, auth=(sonar_token, ""), headers={"Accept": "application/json"}, timeout=30)

    if response.status_code != 200:
        print(f"Error: SonarQube API returned {response.status_code}: {response.text[:500]}", file=sys.stderr)
        sys.exit(1)

    issues = []
    for issue in response.json().get("issues", []):
        issues.append({
            "key": issue.get("key"),
            "rule": issue.get("rule"),
            "severity": issue.get("severity"),
            "component": issue.get("component"),
            "message": issue.get("message"),
            "line": issue.get("line"),
        })

    print(json.dumps(issues))

except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
