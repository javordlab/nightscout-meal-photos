import os
import json
import re
import urllib.request
import time

DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5"
NS_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01"
BASE_URL = "https://p01--sefi--s66fclg7g2lm.code.run/api/v1/treatments.json"

def fetch_all_nightscout():
    all_data = []
    # Fetch in batches if necessary, but 500 should cover everything for a week
    url = f"{BASE_URL}?count=500"
    req = urllib.request.Request(url, headers={"api-secret": NS_SECRET})
    with urllib.request.urlopen(req) as f:
        all_data = json.loads(f.read())
    return all_data

def parse_ns_data(data):
    entries = []
    seen_ids = set()
    
    for t in data:
        if t.get("_id") in seen_ids: continue
        seen_ids.add(t.get("_id"))
        
        ev = t.get("eventType", "")
        cat = "Food" if ev == "Meal Bolus" else "Medication" if ev == "Note" else "Activity" if ev == "Exercise" else "Other"
        
        notes = t.get("notes", "")
        
        # Robust Photo Link Extraction
        photo = None
        # Capture the FIRST http link that looks like an image host
        p_match = re.search(r'(https?://(?:iili\.io|files\.catbox\.moe|cdn\.jsdelivr\.net|freeimage\.host)[^\s\n)]+)', notes)
        if p_match:
            photo = p_match.group(1).strip()
            
        # Robust Carb Extraction
        carbs = t.get("carbs")
        if not carbs:
            # Look for (~45g), 45g carbs, etc.
            c_match = re.search(r'(\d+)\s*g', notes, re.I)
            if c_match:
                carbs = int(c_match.group(1))

        # --- HIGH FIDELITY TITLE LOGIC ---
        full_text = notes
        
        # 1. Capture 'Items identified' if present
        items_match = re.search(r'Items identified:\s*(.*?)(?=\n📷|📷|$)', full_text, re.S | re.I)
        items_list = ""
        if items_match:
            items_list = items_match.group(1).strip().replace('\n', ', ').replace('- ', '')
        
        # 2. Extract the main description line
        # Strip photo markdown
        title = re.sub(r'\[📷\]\(.*?\)', '', full_text)
        # Strip raw camera emoji + URL
        title = re.sub(r'📷\s*https?://\S+', '', title)
        # Strip carb tags
        title = re.sub(r'\(?\s*~?\s*\d+\s*g\s*(?:carbs)?\s*\)?', '', title, flags=re.I)
        # Strip the redundant 'Items identified' block
        title = re.sub(r'Items identified:.*', '', title, flags=re.S | re.I).strip()
        
        # 3. Combine label and items
        if items_list:
            if title and title.lower() in ['breakfast', 'lunch', 'dinner', 'snack']:
                final_title = f"{title}: {items_list}"
            else:
                final_title = title if title else items_list
        else:
            # For entries without 'Items identified', use the cleaned title
            final_title = title if title else (ev if ev else "Health Entry")

        # Cleanup trailing junk
        final_title = re.sub(r'[:\s,-]+$', '', final_title).strip()
        if not final_title: final_title = "Health Entry"

        entries.append({
            "title": final_title[:100],
            "date": t.get("created_at"),
            "category": cat,
            "carbs": carbs,
            "photo": photo
        })
    return entries

def sync_to_notion(entries):
    with open(os.path.expanduser('~/.config/notion/api_key'), 'r') as f:
        key = f.read().strip()
    headers = {"Authorization": f"Bearer {key}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}

    print("Clearing Notion Dashboard...")
    while True:
        q_req = urllib.request.Request(f"https://api.notion.com/v1/databases/{DATABASE_ID}/query", data=b'{}', headers=headers, method='POST')
        with urllib.request.urlopen(q_req) as f:
            res = json.loads(f.read())
            results = res.get('results', [])
            if not results: break
            print(f"Deleting {len(results)} rows...")
            for r in results:
                d_req = urllib.request.Request(f"https://api.notion.com/v1/blocks/{r['id']}", headers=headers, method='DELETE')
                try: urllib.request.urlopen(d_req)
                except: pass
            time.sleep(0.2)

    print(f"Pushing {len(entries)} entries to Notion...")
    # Push chronologically (NS is newest first, so we reverse)
    for e in reversed(entries):
        props = {
            "Entry": {"title": [{"text": {"content": e["title"]}}]},
            "Date": {"date": {"start": e["date"]}},
            "Category": {"select": {"name": e["category"]}},
            "User": {"select": {"name": "Maria Dennis"}}
        }
        if e["carbs"]: props["Carbs (est)"] = {"number": float(e["carbs"])}
        if e["photo"]: props["Photo"] = {"url": e["photo"]}
        
        data = {"parent": {"database_id": DATABASE_ID}, "properties": props}
        req = urllib.request.Request("https://api.notion.com/v1/pages", data=json.dumps(data).encode('utf-8'), headers=headers, method='POST')
        try:
            with urllib.request.urlopen(req) as f:
                print(f"Synced: {e['title'][:40]}... (Photo:{'Y' if e['photo'] else 'N'}, Carbs:{e['carbs']})")
        except Exception as err:
            print(f"Error syncing {e['title'][:20]}: {err}")

if __name__ == "__main__":
    raw_data = fetch_all_nightscout()
    entries = parse_ns_data(raw_data)
    sync_to_notion(entries)
    print("Dashboard Sync Complete.")
