import json
from datetime import datetime, timedelta

# Current time in UTC (Feb 28, 17:30 UTC)
now_utc = datetime(2026, 2, 28, 17, 30, 0)
day24_ago_utc = now_utc - timedelta(hours=24)
day48_ago_utc = now_utc - timedelta(hours=48)
day14_ago_utc = now_utc - timedelta(days=14)

with open('entries_14d.json', 'r') as f:
    entries = json.load(f)

# Sort entries by date (descending)
entries.sort(key=lambda x: x['date'], reverse=True)

def calculate_stats(entries_list):
    if not entries_list:
        return None
    
    sgvs = [e['sgv'] for e in entries_list if 'sgv' in e]
    if not sgvs:
        return None
    
    avg_glucose = sum(sgvs) / len(sgvs)
    # GMI = 3.31 + (0.02392 * avg_glucose)
    gmi = 3.31 + (0.02392 * avg_glucose)
    
    # TIR: 70-180 mg/dL
    in_range = [s for s in sgvs if 70 <= s <= 180]
    tir = (len(in_range) / len(sgvs)) * 100
    
    return {
        'avg': avg_glucose,
        'gmi': gmi,
        'tir': tir,
        'sgvs': sgvs,
        'count': len(sgvs)
    }

# Filtering entries
entries_24h = [e for e in entries if datetime.fromtimestamp(e['date']/1000) >= day24_ago_utc]
entries_prev_24h = [e for e in entries if day48_ago_utc <= datetime.fromtimestamp(e['date']/1000) < day24_ago_utc]
entries_14d = [e for e in entries if datetime.fromtimestamp(e['date']/1000) >= day14_ago_utc]

stats_24h = calculate_stats(entries_24h)
stats_prev_24h = calculate_stats(entries_prev_24h)
stats_14d = calculate_stats(entries_14d)

# Outliers (spikes > 180 or > 250, lows < 70)
outliers = []
for e in entries_24h:
    time_pst = datetime.fromtimestamp(e['date']/1000) - timedelta(hours=8)
    if e['sgv'] > 250:
        outliers.append({'time': time_pst.strftime('%H:%M'), 'sgv': e['sgv'], 'type': 'High Alert'})
    elif e['sgv'] > 180:
        # Check if it's a spike (first point above 180 or peak)
        outliers.append({'time': time_pst.strftime('%H:%M'), 'sgv': e['sgv'], 'type': 'High (>180)'})
    elif e['sgv'] < 70:
        outliers.append({'time': time_pst.strftime('%H:%M'), 'sgv': e['sgv'], 'type': 'Low Alert'})

# Keep only representative outliers (top high, bottom low)
unique_outliers = {}
for o in outliers:
    # Basic grouping by hour to avoid spamming
    key = o['time'][:2]
    if key not in unique_outliers:
        unique_outliers[key] = o
    else:
        if o['type'] == 'Low Alert' or o['sgv'] > unique_outliers[key]['sgv']:
             unique_outliers[key] = o

results = {
    'stats_24h': stats_24h,
    'stats_prev_24h': stats_prev_24h,
    'stats_14d': stats_14d,
    'outliers': list(unique_outliers.values())
}

# Fetch treatments for "Reality Check"
with open('treatments_24h.json', 'r') as f:
    treatments = json.load(f)

# PST 24h window
pst_now = now_utc - timedelta(hours=8)
pst_24h_ago = pst_now - timedelta(hours=24)

# Filter treatments in the last 24h
t_list = []
for t in treatments:
    try:
        t_time = datetime.fromisoformat(t['created_at'].replace('Z', '+00:00'))
        if day24_ago_utc <= t_time.replace(tzinfo=None) <= now_utc:
             t_list.append(t)
    except:
        continue

results['treatments'] = t_list

print(json.dumps(results, indent=2))
