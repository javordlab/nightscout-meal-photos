import json
import sys
from datetime import datetime, timedelta

def calculate_gmi(avg_bg):
    # GMI (%) = 3.31 + 0.02392 * [average glucose in mg/dL]
    return 3.31 + (0.02392 * avg_bg)

def calculate_tir(entries, low, high):
    if not entries:
        return 0, 0, 0
    in_range = [e for e in entries if low <= e['sgv'] <= high]
    above = [e for e in entries if e['sgv'] > high]
    below = [e for e in entries if e['sgv'] < low]
    return (len(in_range) / len(entries)) * 100, (len(above) / len(entries)) * 100, (len(below) / len(entries)) * 100

def run():
    try:
        data = json.load(sys.stdin)
    except Exception as e:
        print(f"Error loading JSON: {e}")
        return

    # Filter for sgv type
    entries = [e for e in data if 'sgv' in e]
    if not entries:
        print("No SGV entries found.")
        return

    # Sort by date
    entries.sort(key=lambda x: x['date'])

    now_utc = datetime.fromisoformat("2026-02-23T07:31:00+00:00")
    one_day_ago = now_utc - timedelta(days=1)
    fourteen_days_ago = now_utc - timedelta(days=14)

    last_24h = [e for e in entries if one_day_ago.timestamp() * 1000 <= e['date'] <= now_utc.timestamp() * 1000]
    last_14d = [e for e in entries if fourteen_days_ago.timestamp() * 1000 <= e['date'] <= now_utc.timestamp() * 1000]

    if not last_24h:
        print("No data for last 24 hours.")
    else:
        avg_24h = sum(e['sgv'] for e in last_24h) / len(last_24h)
        tir_24h, above_24h, below_24h = calculate_tir(last_24h, 80, 180)
        gmi_24h = calculate_gmi(avg_24h)
        
        print(f"24-Hour Summary:")
        print(f"Average: {avg_24h:.1f} mg/dL")
        print(f"GMI: {gmi_24h:.2f}%")
        print(f"TIR (80-180): {tir_24h:.1f}%")
        print(f"Above (>180): {above_24h:.1f}%")
        print(f"Below (<80): {below_24h:.1f}%")
        print()

    if not last_14d:
        print("No data for last 14 days.")
    else:
        avg_14d = sum(e['sgv'] for e in last_14d) / len(last_14d)
        gmi_14d = calculate_gmi(avg_14d)
        print(f"14-Day Rolling Statistics:")
        print(f"Estimated GMI: {gmi_14d:.2f}%")
        print(f"Based on {len(last_14d)} readings.")

if __name__ == "__main__":
    run()
