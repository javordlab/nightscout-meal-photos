import json
from datetime import datetime, timedelta, timezone

# Constants
PST_OFFSET = timedelta(hours=-8)
TIR_LOW = 70
TIR_HIGH = 180

def to_pst(dt_utc):
    return dt_utc.astimezone(timezone(PST_OFFSET))

def gmi(mean_glucose):
    return 3.31 + (0.02392 * mean_glucose)

# Current reference time (Friday, Feb 27, 2026, 9:30 AM PST)
current_time_pst = datetime(2026, 2, 27, 9, 30, tzinfo=timezone(PST_OFFSET))
current_time_utc = current_time_pst.astimezone(timezone.utc)

try:
    with open('/workspace/glucose_data.json', 'r') as f:
        entries = json.load(f)
except Exception:
    entries = []

# Sort entries by date
entries.sort(key=lambda x: x.get('dateString', ''))

# Filter periods
period_24h_start = current_time_utc - timedelta(hours=24)
period_prev_24h_start = current_time_utc - timedelta(hours=48)
period_14d_start = current_time_utc - timedelta(days=14)

glucose_today = []
glucose_prev = []
glucose_14d = []

for e in entries:
    if 'dateString' not in e or 'sgv' not in e: continue
    try:
        dt = datetime.fromisoformat(e['dateString'].replace('Z', '+00:00'))
    except:
        continue
    sgv = e['sgv']
    
    if period_24h_start <= dt <= current_time_utc:
        glucose_today.append({'sgv': sgv, 'dt': dt})
    elif period_prev_24h_start <= dt < period_24h_start:
        glucose_prev.append({'sgv': sgv, 'dt': dt})
    
    if period_14d_start <= dt <= current_time_utc:
        glucose_14d.append({'sgv': sgv, 'dt': dt})

# Calculations - Today
if glucose_today:
    avg_today = sum(e['sgv'] for e in glucose_today) / len(glucose_today)
    tir_today = (len([e for e in glucose_today if TIR_LOW <= e['sgv'] <= TIR_HIGH]) / len(glucose_today)) * 100
    gmi_today = gmi(avg_today)
else:
    avg_today = tir_today = gmi_today = 0

# Calculations - Previous
if glucose_prev:
    avg_prev = sum(e['sgv'] for e in glucose_prev) / len(glucose_prev)
    tir_prev = (len([e for e in glucose_prev if TIR_LOW <= e['sgv'] <= TIR_HIGH]) / len(glucose_prev)) * 100
    gmi_prev = gmi(avg_prev)
else:
    avg_prev = tir_prev = gmi_prev = 0

# Calculations - 14-day
if glucose_14d:
    avg_14d = sum(e['sgv'] for e in glucose_14d) / len(glucose_14d)
    gmi_14d = gmi(avg_14d)
else:
    gmi_14d = 0

# Outliers (Today)
spikes = [e for e in glucose_today if e['sgv'] > 250]
lows = [e for e in glucose_today if e['sgv'] < 70]

# Trends
trend_avg = "improving" if avg_today < avg_prev - 5 else "stable" if abs(avg_today - avg_prev) <= 5 else "higher"
trend_tir = "improving" if tir_today > tir_prev + 5 else "stable" if abs(tir_today - tir_prev) <= 5 else "declining"

# Output for report
report = {
    "summary_24h": {
        "avg": round(avg_today, 1),
        "tir": round(tir_today, 1),
        "gmi": round(gmi_today, 2)
    },
    "gmi_14d": round(gmi_14d, 2),
    "trends": {
        "avg": trend_avg,
        "tir": trend_tir,
        "prev_avg": round(avg_prev, 1),
        "prev_tir": round(tir_prev, 1)
    },
    "outliers": {
        "spikes": [{"sgv": e['sgv'], "time": to_pst(e['dt']).strftime('%I:%M %p')} for e in spikes],
        "lows": [{"sgv": e['sgv'], "time": to_pst(e['dt']).strftime('%I:%M %p')} for e in lows]
    }
}

print(json.dumps(report, indent=2))
