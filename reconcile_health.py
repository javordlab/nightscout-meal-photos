import requests
import json
from datetime import datetime

def _local_tz_offset():
    _off = datetime.now().astimezone().strftime('%z')  # e.g. "-0700"
    return f"{_off[:3]}:{_off[3:]}"  # e.g. "-07:00"

NOTION_TOKEN = "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"
DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5"
HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
}

def get_notion_entries():
    url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"
    payload = {
        "filter": {
            "property": "Date",
            "date": { "on_or_after": f"2026-03-08T00:00:00{_local_tz_offset()}" }
        }
    }
    res = requests.post(url, headers=HEADERS, json=payload)
    return res.json().get("results", [])

def update_notion_date(page_id, new_date_str):
    url = f"https://api.notion.com/v1/pages/{page_id}"
    payload = {
        "properties": {
            "Date": { "date": { "start": new_date_str } }
        }
    }
    requests.patch(url, headers=HEADERS, json=payload)

def delete_notion_page(page_id):
    url = f"https://api.notion.com/v1/pages/{page_id}"
    payload = { "archived": True }
    requests.patch(url, headers=HEADERS, json=payload)

entries = get_notion_entries()
actions_taken = []

# Group by normalized entry/time to find duplicates
seen = {} # (Title, YYYY-MM-DD, HH:MM) -> page_id

for page in entries:
    props = page["properties"]
    title = "".join([t["plain_text"] for t in props["Entry"]["title"]])
    date_val = props["Date"]["date"]["start"]
    
    # Extract date and time parts
    # Format: 2026-03-08T09:43:00.000-08:00
    dt_part = date_val.split("T")
    date_str = dt_part[0]
    time_str = dt_part[1][:5] # HH:MM
    offset = date_val[-6:]
    
    # Normalize offset: any entry not using the current host timezone offset gets updated.
    # Clock time (HH:MM) is preserved — only the offset is corrected.
    key = (title, date_str, time_str)

    # Simplified approach:
    # 1. Update any hardcoded offset to the host's current local offset
    # 2. Remove exact duplicates (Title, Date, Time)
    local_off = _local_tz_offset()
    new_date_str = f"{date_str}T{time_str}:00.000{local_off}"
    if offset != local_off:
        update_notion_date(page["id"], new_date_str)
        actions_taken.append(f"Updated offset for {title} at {time_str}")
        offset = local_off
    
    key = (title, date_str, time_str)
    if key in seen:
        delete_notion_page(page["id"])
        actions_taken.append(f"Deleted duplicate: {title} at {time_str}")
    else:
        seen[key] = page["id"]

if not actions_taken:
    print("No action needed today.")
else:
    print("Sync and reconciliation complete:")
    for a in actions_taken:
        print(f"- {a}")

