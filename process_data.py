import json
from datetime import datetime, timedelta, timezone

# Constants
GMI_FORMULA = lambda avg: 3.31 + (0.02392 * avg)
TIR_MIN = 70
TIR_MAX = 180
import datetime as _dt
_LOCAL_TZ = _dt.datetime.now().astimezone().tzinfo

# Load data
with open('entries.json', 'r') as f:
    content = f.read()
    # Check if it starts with [ and ends with ]
    if not content.startswith('['):
        # Maybe it's a list of objects but the file starts with something else or is truncated?
        # Actually looking at the head output, it seems to be a valid JSON array or a list of objects.
        # Let's try parsing it.
        try:
            entries = json.loads('[' + content + ']')
        except:
            # Maybe it's already an array
            entries = json.loads(content)
    else:
        entries = json.loads(content)

current_time_utc = datetime.now(timezone.utc)
now_minus_24h = current_time_utc - timedelta(hours=24)
now_minus_48h = current_time_utc - timedelta(hours=48)
now_minus_14d = current_time_utc - timedelta(days=14)

def parse_date(date_str):
    return datetime.fromisoformat(date_str.replace('Z', '+00:00'))

def format_pst(date_utc):
    pst = date_utc.astimezone()
    return pst.strftime('%I:%M %p')

def calculate_stats(data_subset):
    if not data_subset:
        return None
    glucoses = [e['sgv'] for e in data_subset if 'sgv' in e]
    if not glucoses:
        return None
    avg = sum(glucoses) / len(glucoses)
    tir = (len([g for g in glucoses if TIR_MIN <= g <= TIR_MAX]) / len(glucoses)) * 100
    gmi = GMI_FORMULA(avg)
    return {'avg': avg, 'tir': tir, 'gmi': gmi}

# 1. 24-hour summary (Today)
today_entries = [e for e in entries if 'dateString' in e and now_minus_24h <= parse_date(e['dateString']) <= current_time_utc]
today_stats = calculate_stats(today_entries)

# 2. Previous 24-hour summary (Yesterday)
yesterday_entries = [e for e in entries if 'dateString' in e and now_minus_48h <= parse_date(e['dateString']) < now_minus_24h]
yesterday_stats = calculate_stats(yesterday_entries)

# 3. 14-day rolling GMI
last_14d_entries = [e for e in entries if 'dateString' in e and now_minus_14d <= parse_date(e['dateString']) <= current_time_utc]
last_14d_stats = calculate_stats(last_14d_entries)

# 4. Outliers (Spikes > 220, Lows < 70)
outliers = []
for e in today_entries:
    val = e['sgv']
    if val > 220 or val < 70:
        outliers.append({'val': val, 'time': parse_date(e['dateString'])})

# Load treatments for Reality Check context
try:
    with open('treatments.json', 'r') as f:
        treatments = json.load(f)
except:
    treatments = []

# Filter relevant treatments (last 24h)
recent_treatments = [t for t in treatments if 'created_at' in t and now_minus_24h <= parse_date(t['created_at']) <= current_time_utc]

# Summarize treatments for thinking
treat_summary = []
for t in recent_treatments:
    event_type = t.get('eventType', 'Note')
    notes = t.get('notes', '')
    carbs = t.get('carbs', '')
    time = format_pst(parse_date(t['created_at']))
    treat_summary.append(f"{time}: {event_type} - {notes} ({carbs}g carbs)")

results = {
    'today': today_stats,
    'yesterday': yesterday_stats,
    'rolling_14d': last_14d_stats,
    'outliers': [{'val': o['val'], 'time': format_pst(o['time'])} for o in outliers],
    'treatments': treat_summary
}

print(json.dumps(results, indent=2))
