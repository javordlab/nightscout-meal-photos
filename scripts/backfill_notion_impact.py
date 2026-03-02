import json
import requests
import datetime
from dateutil import parser
import os

NOTION_KEY = os.popen('cat ~/.config/notion/api_key').read().strip()
NOTION_VERSION = "2025-09-03"
DATA_SOURCE_ID = "31685ec7-0668-815a-bc98-000bab1964f3"
NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run"

headers = {
    "Authorization": f"Bearer {NOTION_KEY}",
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json"
}

def get_ns_entries(count=1000):
    r = requests.get(f"{NS_URL}/api/v1/entries.json?count={count}")
    return r.json()

def get_notion_items():
    results = []
    has_more = True
    next_cursor = None
    while has_more:
        payload = {"page_size": 100}
        if next_cursor:
            payload["start_cursor"] = next_cursor
        r = requests.post(f"https://api.notion.com/v1/data_sources/{DATA_SOURCE_ID}/query", headers=headers, json=payload)
        data = r.json()
        results.extend(data.get("results", []))
        has_more = data.get("has_more", False)
        next_cursor = data.get("next_cursor", None)
    return results

def get_bg_at(entries, timestamp):
    target = timestamp.timestamp() * 1000
    closest = None
    min_diff = 10 * 60 * 1000 # 10 minutes
    for e in entries:
        diff = abs(e['mills'] - target)
        if diff < min_diff:
            min_diff = diff
            closest = e
    return closest['sgv'] if closest else None

def get_peak_2hr(entries, meal_ts):
    start = meal_ts.timestamp() * 1000
    end = (meal_ts + datetime.timedelta(hours=3.5)).timestamp() * 1000 # Extended search window
    peak_bg = 0
    peak_time_ms = None
    for e in entries:
        if start <= e['mills'] <= end:
            if e['sgv'] > peak_bg:
                peak_bg = e['sgv']
                peak_time_ms = e['mills']
    
    peak_ts = datetime.datetime.fromtimestamp(peak_time_ms / 1000, tz=datetime.timezone.utc) if peak_time_ms else None
    return peak_bg, peak_ts

ns_entries = get_ns_entries()
notion_items = get_notion_items()

print(f"Checking {len(notion_items)} Notion items...")

for item in notion_items:
    props = item['properties']
    category = props.get('Category', {}).get('select', {}).get('name')
    if category != "Food":
        continue
    
    bg_delta_prop = props.get('BG Delta', {})
    bg_delta_val = bg_delta_prop.get('number')
    
    # Check if ANY of the impact columns are missing
    pre_bg_prop = props.get('Pre-Meal BG', {}).get('number')
    peak_bg_prop = props.get('2hr Peak BG', {}).get('number')
    
    if bg_delta_val is not None and pre_bg_prop is not None and peak_bg_prop is not None:
        continue # Already fully processed
        
    date_str = props.get('Date', {}).get('date', {}).get('start')
    if not date_str:
        continue
    
    meal_ts = parser.parse(date_str)
    # Correct for local time vs UTC in Nightscout if needed
    # If the date_str has no timezone, assume it's UTC or the local time based on the script
    
    pre_bg = get_bg_at(ns_entries, meal_ts)
    peak_bg, peak_ts = get_peak_2hr(ns_entries, meal_ts)
    
    if pre_bg and peak_bg:
        delta = peak_bg - pre_bg
        time_to_peak = int((peak_ts - meal_ts).total_seconds() / 60) if peak_ts else None
        
        entry_title = props.get('Entry', {}).get('title', [])
        title_text = entry_title[0]['text']['content'] if entry_title else "Untitled"
        
        update_payload = {
            "properties": {
                "Pre-Meal BG": {"number": pre_bg},
                "2hr Peak BG": {"number": peak_bg},
                "BG Delta": {"number": delta},
            }
        }
        if peak_ts:
            update_payload["properties"]["Peak Time"] = {"date": {"start": peak_ts.isoformat()}}
        if time_to_peak is not None:
            update_payload["properties"]["Time to Peak (min)"] = {"number": time_to_peak}
            
        print(f"Updating '{title_text}' ({meal_ts}): Pre {pre_bg}, Peak {peak_bg}, Delta {delta}")
        r = requests.patch(f"https://api.notion.com/v1/pages/{item['id']}", headers=headers, json=update_payload)
        if r.status_code != 200:
            print(f"Error updating {item['id']}: {r.text}")

