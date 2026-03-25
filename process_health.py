import json
from datetime import datetime, timedelta, timezone

# 1. Load data
with open('glucose_48h.json', 'r') as f:
    glucose_48h = json.load(f)

with open('glucose_14d.json', 'r') as f:
    glucose_14d = json.load(f)

with open('treatments_48h.json', 'r') as f:
    treatments_48h = json.load(f)

# Helper: UTC to host system timezone
def to_pst(dt_utc):
    return dt_utc.astimezone()

now_utc = datetime.now(timezone.utc)
yesterday_utc = now_utc - timedelta(days=1)
two_days_ago_utc = now_utc - timedelta(days=2)

# Previous calendar day midnight bounds in local timezone → UTC
_now_local = datetime.now().astimezone()
_today = _now_local.date()
_yesterday = _today - timedelta(days=1)
cal_start_utc = datetime(_yesterday.year, _yesterday.month, _yesterday.day).astimezone(timezone.utc)
cal_end_utc = datetime(_today.year, _today.month, _today.day).astimezone(timezone.utc)

# 2. Glucose metrics (last 24h)
last_24h_sgv = [e['sgv'] for e in glucose_48h if yesterday_utc <= datetime.fromisoformat(e['dateString'].replace('Z', '+00:00')) < now_utc]
prev_24h_sgv = [e['sgv'] for e in glucose_48h if two_days_ago_utc <= datetime.fromisoformat(e['dateString'].replace('Z', '+00:00')) < yesterday_utc]

def get_stats(sgv_list):
    if not sgv_list: return None
    avg = sum(sgv_list) / len(sgv_list)
    tir = len([s for s in sgv_list if 70 <= s <= 180]) / len(sgv_list) * 100
    gmi = 3.31 + 0.02392 * avg
    return {"avg": avg, "tir": tir, "gmi": gmi}

stats_24h = get_stats(last_24h_sgv)
stats_prev_24h = get_stats(prev_24h_sgv)

# 3. 14-day rolling GMI
all_14d_sgv = [e['sgv'] for e in glucose_14d]
stats_14d = get_stats(all_14d_sgv)

# 4. Outliers (last 24h)
outliers = []
for e in glucose_48h:
    dt = datetime.fromisoformat(e['dateString'].replace('Z', '+00:00'))
    if yesterday_utc <= dt < now_utc:
        if e['sgv'] > 250 or e['sgv'] < 70:
            pst_time = to_pst(dt).strftime('%I:%M %p')
            outliers.append(f"{pst_time}: {e['sgv']} mg/dL")

# 5. Calories and Carbs (Previous local calendar day)
total_carbs = 0
total_calories = 0
for t in treatments_48h:
    # Ensure 'created_at' exists
    created_str = t.get('created_at') or t.get('timestamp')
    if not created_str: continue
    dt = datetime.fromisoformat(created_str.replace('Z', '+00:00'))
    if cal_start_utc <= dt < cal_end_utc:
        total_carbs += float(t.get('carbs', 0) or 0)
        # Calories often in notes or custom fields
        notes = t.get('notes', '')
        if notes and '~' in notes and 'kcal' in notes:
            import re
            m = re.search(r'~(\d+)\s*kcal', notes)
            if m:
                total_calories += int(m.group(1))

# 6. Report Generation
print(json.dumps({
    "stats_24h": stats_24h,
    "stats_prev_24h": stats_prev_24h,
    "stats_14d": stats_14d,
    "outliers": outliers,
    "total_carbs": total_carbs,
    "total_calories": total_calories
}, indent=2))
