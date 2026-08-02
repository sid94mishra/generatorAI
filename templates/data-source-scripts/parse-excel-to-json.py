#!/usr/bin/env python3
"""
Parse Excel to JSON — Data source script for GeneratorAI automations.
Reads an Excel file (.xlsx) and outputs rows as JSON array to stdout.

Environment Variables:
  EXCEL_FILE   Required. Path to Excel file (.xlsx)
  SHEET_NAME   Optional. Sheet name to read (default: first sheet)

Dependencies:
  pip install openpyxl
"""
import sys
import os
import json

if "--help" in sys.argv or "-h" in sys.argv:
    print(__doc__, file=sys.stderr)
    sys.exit(0)

excel_file = os.getenv("EXCEL_FILE", "").strip()
sheet_name = os.getenv("SHEET_NAME", "").strip()

if not excel_file:
    print("Error: Missing required env var: EXCEL_FILE", file=sys.stderr)
    sys.exit(1)

if not os.path.exists(excel_file):
    print(f"Error: File not found: {excel_file}", file=sys.stderr)
    sys.exit(1)

try:
    from openpyxl import load_workbook
except ImportError:
    print("Error: openpyxl not installed. Install with: pip install openpyxl", file=sys.stderr)
    sys.exit(1)

try:
    wb = load_workbook(excel_file, data_only=True)

    if sheet_name:
        if sheet_name not in wb.sheetnames:
            print(f"Error: Sheet '{sheet_name}' not found. Available: {', '.join(wb.sheetnames)}", file=sys.stderr)
            sys.exit(1)
        ws = wb[sheet_name]
    else:
        ws = wb.active

    rows = []
    headers = None
    for row_idx, row in enumerate(ws.iter_rows(values_only=True), 1):
        if row_idx == 1:
            headers = [str(c).strip() if c else f"col_{i}" for i, c in enumerate(row, 1)]
            continue
        if all(c is None for c in row):
            continue
        obj = {}
        for col_idx, cell in enumerate(row):
            h = headers[col_idx] if col_idx < len(headers) else f"col_{col_idx + 1}"
            obj[h] = cell
        rows.append(obj)

    print(json.dumps(rows, default=str))

except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
