import json
from datetime import datetime, timedelta, timezone

# Load data
with open('glucose_14d.json', 'r') as f:
    entries = json.load(f)

# Current time in UTC (simulated as per prompt context)
# Tuesday, Feb 24, 2026, 9:30 AM PST -> 17:30 UTC
now_utc = datetime(2026, 2, 24, 17, 30, tzinfo=timezone.utc)
day24_ago_utc = now_utc - timedelta(days=1)
day48_ago_utc = now_utc - timedelta(days=2)
day14_ago_utc = now_utc - timedelta(days=14)

# Filter entries
entries_24h = []
entries_prev_24h = []
entries_14d = []

for e in entries:
    # dateString format: "2026-02-24T17:25:00.000Z"
    dt = datetime.fromisoformat(e['dateString'].replace('Z', '+00:00'))
    sgv = e.get('sgv')
    if sgv is None: continue
    
    if dt >= day24_ago_utc:
        entries_24h.append(sgv)
    elif dt >= day48_ago_utc:
        entries_prev_24h.append(sgv)
    
    if dt >= day14_ago_utc:
        entries_14d.append((dt, sgv))

def calc_stats(sgvs):
    if not sgvs: return None
    avg = sum(sgvs) / len(sgvs)
    tir = (len([s for s in sgvs if 70 <= s <= 180]) / len(sgvs)) * 100
    gmi = 3.31 + (0.02392 * avg)
    return {'avg': avg, 'tir': tir, 'gmi': gmi}

stats_24h = calc_stats(entries_24h)
stats_prev_24h = calc_stats(entries_prev_24h)
stats_14d = calc_stats([s for dt, s in entries_14d])

# Outliers in last 24h
outliers = []
for e in entries:
    dt = datetime.fromisoformat(e['dateString'].replace('Z', '+00:00'))
    if dt >= day24_ago_utc:
        sgv = e.get('sgv')
        if sgv and (sgv > 250 or sgv < 70):
            pst_time = dt - timedelta(hours=8)
            outliers.append(f"{pst_time.strftime('%I:%M %p')}: {sgv} mg/dL")

print(json.dumps({
    'stats_24h': stats_24h,
    'stats_prev_24h': stats_prev_24h,
    'stats_14d': stats_14d,
    'outliers': outliers[:5] # Limit outliers
}, indent=2))
