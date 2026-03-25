import json
from datetime import datetime, timedelta, timezone

# Load the data
with open('entries.json', 'r') as f:
    entries = json.load(f)

# Use host system timezone.
# Current time provided: Tuesday, March 3rd, 2026 — 9:30 AM (host timezone)
now_pst = datetime(2026, 3, 3, 9, 30).astimezone()
now_utc = now_pst.astimezone(timezone.utc)

# Ranges in UTC
last_24h_start = now_utc - timedelta(hours=24)
prev_24h_start = now_utc - timedelta(hours=48)
last_14d_start = now_utc - timedelta(days=14)

def calculate_metrics(entries_list):
    if not entries_list:
        return None
    
    sgvs = [e['sgv'] for e in entries_list]
    avg_glucose = sum(sgvs) / len(sgvs)
    
    # TIR: 70-180 mg/dL
    in_range = [s for s in sgvs if 70 <= s <= 180]
    tir = (len(in_range) / len(sgvs)) * 100
    
    # GMI (%) = 3.31 + 0.02392 * avg_glucose_mgdL
    gmi = 3.31 + 0.02392 * avg_glucose
    
    return {
        'avg': avg_glucose,
        'tir': tir,
        'gmi': gmi,
        'count': len(sgvs)
    }

# Filter entries
entries_last_24h = []
entries_prev_24h = []
entries_last_14d = []

for e in entries:
    # Use 'dateString' or 'date' (timestamp in ms)
    # Nightscout date is in ms
    dt = datetime.fromtimestamp(e['date'] / 1000, tz=timezone.utc)
    
    if last_24h_start <= dt <= now_utc:
        entries_last_24h.append(e)
    if prev_24h_start <= dt < last_24h_start:
        entries_prev_24h.append(e)
    if last_14d_start <= dt <= now_utc:
        entries_last_14d.append(e)

metrics_24h = calculate_metrics(entries_last_24h)
metrics_prev_24h = calculate_metrics(entries_prev_24h)
metrics_14d = calculate_metrics(entries_last_14d)

# Outliers in last 24h
outliers = []
# Thresholds: High > 180, Low < 70
for e in sorted(entries_last_24h, key=lambda x: x['date']):
    dt_pst = datetime.fromtimestamp(e['date'] / 1000, tz=timezone.utc).astimezone(datetime.now().astimezone().tzinfo)
    if e['sgv'] > 220 or e['sgv'] < 65: # Looking for significant outliers
        outliers.append((dt_pst.strftime('%I:%M %p'), e['sgv']))

# Group consecutive outliers
grouped_outliers = []
if outliers:
    start_time, val = outliers[0]
    last_time = start_time
    peak_val = val
    for i in range(1, len(outliers)):
        curr_time, curr_val = outliers[i]
        # If within 30 mins, consider same event (simplification)
        # Actually just report significant spikes/lows
        if curr_val > peak_val if val > 180 else curr_val < peak_val:
             peak_val = curr_val
    # This is a bit simple, let's just find the max/min in the last 24h
    max_sgv = max([e['sgv'] for e in entries_last_24h]) if entries_last_24h else 0
    min_sgv = min([e['sgv'] for e in entries_last_24h]) if entries_last_24h else 0
    
    max_entry = next(e for e in entries_last_24h if e['sgv'] == max_sgv)
    min_entry = next(e for e in entries_last_24h if e['sgv'] == min_sgv)
    
    max_time = datetime.fromtimestamp(max_entry['date'] / 1000, tz=timezone.utc).astimezone(datetime.now().astimezone().tzinfo).strftime('%I:%M %p')
    min_time = datetime.fromtimestamp(min_entry['date'] / 1000, tz=timezone.utc).astimezone(datetime.now().astimezone().tzinfo).strftime('%I:%M %p')

print(json.dumps({
    'metrics_24h': metrics_24h,
    'metrics_prev_24h': metrics_prev_24h,
    'metrics_14d': metrics_14d,
    'max': {'val': max_sgv, 'time': max_time} if entries_last_24h else None,
    'min': {'val': min_sgv, 'time': min_time} if entries_last_24h else None
}, indent=2))
