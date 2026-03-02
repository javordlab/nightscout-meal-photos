import os
import json
import requests
from datetime import datetime, timedelta, timezone

# Configuration
NOTION_TOKEN = open(os.path.expanduser("~/.config/notion/api_key")).read().strip()
DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5"
NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run"
NS_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01"

HEADERS_NOTION = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": "2025-09-03"
}

HEADERS_NS = {
    "api-secret": NS_SECRET,
    "Content-Type": "application/json"
}

def get_notion_food_entries():
    url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"
    payload = {
        "filter": {
            "and": [
                {"property": "Category", "select": {"equals": "Food"}},
                {"property": "2hr Peak BG", "number": {"is_empty": True}}
            ]
        }
    }
    res = requests.post(url, headers=HEADERS_NOTION, json=payload)
    return res.json().get("results", [])

def get_ns_glucose(start_iso, end_iso):
    # Fetch entries between start and end
    # Nightscout find uses find[dateString][$gte]
    url = f"{NS_URL}/api/v1/entries.json?find[dateString][$gte]={start_iso}&find[dateString][$lte]={end_iso}&count=1000"
    res = requests.get(url, headers=HEADERS_NS)
    return res.json()

def update_notion_row(page_id, pre_meal, peak, peak_time_iso, delta):
    url = f"https://api.notion.com/v1/pages/{page_id}"
    
    # Calculate Time to Peak (min)
    # peak_time is ISO string
    
    properties = {
        "Pre-Meal BG": {"number": pre_meal},
        "2hr Peak BG": {"number": peak},
        "BG Delta": {"number": delta}
    }
    
    if peak_time_iso:
        properties["Peak Time"] = {"rich_text": [{"text": {"content": peak_time_iso}}]}
        
    requests.patch(url, headers=HEADERS_NOTION, json={"properties": properties})

def process_impact():
    entries = get_notion_food_entries()
    print(f"Found {len(entries)} food entries needing impact analysis.")
    
    for entry in entries:
        page_id = entry["id"]
        props = entry["properties"]
        entry_name = props["Entry"]["title"][0]["plain_text"]
        date_str = props["Date"]["date"]["start"]
        
        meal_time = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        # We need data up to 3 hours after meal to ensure we see the peak
        end_window = meal_time + timedelta(hours=3)
        
        # Check if enough time has passed (at least 2.5 hours)
        if datetime.now(timezone.utc) < (meal_time + timedelta(minutes=150)):
            print(f"Skipping '{entry_name}': too recent.")
            continue
            
        print(f"Analyzing impact for: {entry_name} at {date_str}")
        
        # Get glucose data around the meal
        glucose_data = get_ns_glucose((meal_time - timedelta(minutes=15)).isoformat(), end_window.isoformat())
        
        if not glucose_data:
            print(f"No glucose data found for window.")
            continue
            
        # Sort by time
        glucose_data.sort(key=lambda x: x["dateString"])
        
        # Pre-meal: closest to meal_time or just before
        pre_meal_entries = [g for g in glucose_data if datetime.fromisoformat(g["dateString"].replace("Z", "+00:00")) <= meal_time]
        pre_meal_bg = pre_meal_entries[-1]["sgv"] if pre_meal_entries else glucose_data[0]["sgv"]
        
        # Window for peak: meal_time to meal_time + 2.5h
        peak_window = [g for g in glucose_data if meal_time < datetime.fromisoformat(g["dateString"].replace("Z", "+00:00")) <= (meal_time + timedelta(minutes=150))]
        
        if not peak_window:
            print(f"No glucose data in the peak window.")
            continue
            
        peak_entry = max(peak_window, key=lambda x: x["sgv"])
        peak_bg = peak_entry["sgv"]
        peak_time_iso = peak_entry["dateString"]
        delta = peak_bg - pre_meal_bg
        
        print(f"  Pre: {pre_meal_bg} | Peak: {peak_bg} | Delta: {delta}")
        update_notion_row(page_id, pre_meal_bg, peak_bg, peak_time_iso, delta)

if __name__ == "__main__":
    process_impact()
