import json
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

def _local_tz_offset():
    _off = datetime.now().astimezone().strftime('%z')  # e.g. "-0700"
    return f"{_off[:3]}:{_off[3:]}"  # e.g. "-07:00"

NOTION_TOKEN = "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"
DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5"

def notion_api(endpoint, method="POST", payload=None):
    url = f"https://api.notion.com/v1/{endpoint}"
    headers = {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
    }
    data = json.dumps(payload).encode("utf-8") if payload else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode("utf-8"))
    except Exception as e:
        print(f"API Error: {e}")
        return None

def get_notion_entries():
    since = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d")
    payload = {
        "filter": {
            "property": "Date",
            "date": { "on_or_after": f"{since}T00:00:00{_local_tz_offset()}" }
        }
    }
    res = notion_api(f"databases/{DATABASE_ID}/query", payload=payload)
    return res.get("results", []) if res else []

def add_to_notion(date_str, time_str, category, subcat, details, carbs, kcal):
    title = details.split("[")[0].strip()
    if not title: title = f"{category} Entry"
    notion_date = f"{date_str}T{time_str}:00.000{_local_tz_offset()}"
    
    props = {
        "Entry": {"title": [{"text": {"content": title}}]},
        "Date": {"date": {"start": notion_date}},
        "Category": {"select": {"name": category}},
        "Details": {"rich_text": [{"text": {"content": details}}]}
    }
    if subcat and subcat != "-": props["Subcategory"] = {"select": {"name": subcat}}
    if carbs and carbs != "null":
        try: props["Carbs (g)"] = {"number": float(carbs)}
        except: pass
    if kcal and kcal != "null":
        try: props["Calories"] = {"number": float(kcal)}
        except: pass

    return notion_api("pages", payload={"parent": {"database_id": DATABASE_ID}, "properties": props})

def parse_local_log(filepath):
    entries = []
    # Broaden window to last 48h to catch everything for "reconciliation"
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    today = datetime.now().strftime("%Y-%m-%d")
    
    try:
        with open(filepath, 'r') as f:
            for line in f:
                if not line.startswith("|"): continue
                parts = [p.strip() for p in line.split("|")]
                if len(parts) < 9: continue
                
                date_str = parts[1]
                if date_str not in [yesterday, today]: continue
                
                time_part = parts[2].split(" ")[0]
                category = parts[4]
                subcategory = parts[5]
                details = parts[6]
                carbs = parts[7]
                kcal = parts[8]
                
                entries.append({
                    "date": date_str, "time": time_part, "cat": category, 
                    "sub": subcategory, "det": details, "carbs": carbs, "kcal": kcal
                })
    except Exception as e: print(f"Log Error: {e}")
    return entries

def main():
    local_entries = parse_local_log("/Users/javier/.openclaw/workspace/health_log.md")
    notion_entries = get_notion_entries()
    
    notion_lookup = set()
    for ne in notion_entries:
        props = ne["properties"]
        try:
            n_date_full = props["Date"]["date"]["start"]
            n_date = n_date_full[:10]
            n_time = n_date_full[11:16]
            n_title = "".join([t["plain_text"] for t in props["Entry"]["title"]])[:10]
            notion_lookup.add((n_date, n_time, n_title))
        except: continue

    added_count = 0
    for le in local_entries:
        l_title = le["det"].split("[")[0].strip()[:10]
        if (le["date"], le["time"], l_title) not in notion_lookup:
            if add_to_notion(le["date"], le["time"], le["cat"], le["sub"], le["det"], le["carbs"], le["kcal"]):
                added_count += 1

    fixed_offsets = 0
    for ne in notion_entries:
        try:
            n_date_full = ne["properties"]["Date"]["date"]["start"]
            local_off = _local_tz_offset()
            if local_off not in n_date_full and ("-07:00" in n_date_full or "-08:00" in n_date_full):
                new_date = n_date_full.replace("-07:00", local_off).replace("-08:00", local_off)
                if notion_api(f"pages/{ne['id']}", method="PATCH", payload={"properties": {"Date": {"date": {"start": new_date}}}}):
                    fixed_offsets += 1
        except: continue

    if added_count == 0 and fixed_offsets == 0:
        print("No action needed today.")
    else:
        print(f"Sync complete: Added {added_count}, Fixed {fixed_offsets} offsets.")

if __name__ == "__main__":
    main()
