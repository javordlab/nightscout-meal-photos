import json
from datetime import datetime, timedelta, timezone

# PST offset is -8 hours
PST_OFFSET = -8

def utc_to_pst(utc_str):
    # Nightscout usually uses ISO8601 or timestamps
    try:
        dt = datetime.fromisoformat(utc_str.replace('Z', '+00:00'))
    except ValueError:
        # Fallback to timestamp if needed
        dt = datetime.fromtimestamp(int(utc_str)/1000, tz=timezone.utc)
    pst_dt = dt + timedelta(hours=PST_OFFSET)
    return pst_dt

def format_pst(pst_dt):
    return pst_dt.strftime('%H:%M PST')

# Current time in PST (from prompt)
current_time_pst = datetime(2026, 2, 26, 9, 30, tzinfo=timezone(timedelta(hours=PST_OFFSET)))
# Convert to UTC for comparison
current_time_utc = current_time_pst + timedelta(hours=8)

last_24h_start = current_time_pst - timedelta(days=1)
prev_24h_start = current_time_pst - timedelta(days=2)
last_14d_start = current_time_pst - timedelta(days=14)

with open('glucose_data.json', 'r') as f:
    entries = json.load(f)

# Sort by date (descending usually, but let's be safe)
entries.sort(key=lambda x: x['date'], reverse=True)

# Period definitions
p_last_24 = []
p_prev_24 = []
p_last_14 = []

for e in entries:
    # Use 'date' (timestamp) or 'dateString' (ISO8601)
    dt_utc = datetime.fromtimestamp(e['date'] / 1000, tz=timezone.utc)
    dt_pst = dt_utc + timedelta(hours=PST_OFFSET)
    
    val = e.get('sgv') or e.get('mbg') # Sensor Glucose Value
    if val is None: continue

    if dt_pst >= last_24h_start:
        p_last_24.append({'val': val, 'time': dt_pst})
    elif dt_pst >= prev_24h_start:
        p_prev_24.append({'val': val, 'time': dt_pst})
    
    if dt_pst >= last_14d_start:
        p_last_14.append({'val': val, 'time': dt_pst})

def calc_metrics(data):
    if not data: return None
    vals = [d['val'] for d in data]
    avg = sum(vals) / len(vals)
    gmi = 3.31 + (0.02392 * avg)
    tir_count = sum(1 for v in vals if 70 <= v <= 180)
    tir_pct = (tir_count / len(vals)) * 100
    return {'avg': avg, 'gmi': gmi, 'tir': tir_pct}

m_last_24 = calc_metrics(p_last_24)
m_prev_24 = calc_metrics(p_prev_24)
m_last_14 = calc_metrics(p_last_14)

# Outliers last 24h
spikes = [d for d in p_last_24 if d['val'] > 250]
lows = [d for d in p_last_24 if d['val'] < 70]

# Trend Comparison
trend = "Stable"
if m_last_24 and m_prev_24:
    if m_last_24['tir'] > m_prev_24['tir'] + 5:
        trend = "Improving (Higher TIR) 📈"
    elif m_last_24['tir'] < m_prev_24['tir'] - 5:
        trend = "Declining (Lower TIR) 📉"
    elif m_last_24['avg'] < m_prev_24['avg'] - 10:
        trend = "Improving (Lower Average) 📈"
    elif m_last_24['avg'] > m_prev_24['avg'] + 10:
        trend = "Declining (Higher Average) 📉"

print(json.dumps({
    "last_24h": m_last_24,
    "prev_24h": m_prev_24,
    "last_14d_gmi": m_last_14['gmi'] if m_last_14 else None,
    "trend": trend,
    "spikes": [{"val": s['val'], "time": format_pst(s['time'])} for s in spikes],
    "lows": [{"val": l['val'], "time": format_pst(l['time'])} for l in lows]
}))
