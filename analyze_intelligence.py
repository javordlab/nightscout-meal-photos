import json
from datetime import datetime, timedelta, timezone

def analyze_glucose_correlation():
    # Load Glucose Data
    with open('glucose_14d.json', 'r') as f:
        glucose_entries = json.load(f)
    
    # Load Treatment Data
    with open('treatments_data.json', 'r') as f:
        treatments = json.load(f)

    # Convert timestamps to objects
    # Note: glucose_14d.json dates are from Feb 22-24, 2026.
    # treatments_data.json dates are from Feb 26-27, 2026.
    # To demonstrate correlation, we need to handle the time gap or use older treatment data if available.
    # Let's check for any overlapping dates.
    
    g_dts = sorted([datetime.fromisoformat(g['dateString'].replace('Z', '+00:00')) for g in glucose_entries])
    t_dts = sorted([datetime.fromisoformat(t['created_at'].replace('Z', '+00:00')) for t in treatments])
    
    # If no overlap, we will simulate the logic or look for older treatments if they were in treatments_24h.json
    # Actually, the user wants me to find TOOLS. I should build the script to be robust for future use.
    
    for g in glucose_entries:
        g['dt'] = datetime.fromisoformat(g['dateString'].replace('Z', '+00:00'))
    
    for t in treatments:
        t['dt'] = datetime.fromisoformat(t['created_at'].replace('Z', '+00:00'))

    results = []

    # Analyze Meals
    meals = [t for t in treatments if t['eventType'] == 'Meal Bolus']
    for meal in meals:
        start_time = meal['dt']
        end_time = start_time + timedelta(hours=3)
        
        window_sgvs = [g['sgv'] for g in glucose_entries if start_time <= g['dt'] <= end_time]
        
        if window_sgvs:
            pre_meal = [g['sgv'] for g in glucose_entries if start_time - timedelta(minutes=30) <= g['dt'] <= start_time]
            baseline = pre_meal[-1] if pre_meal else window_sgvs[0]
            peak = max(window_sgvs)
            rise = peak - baseline
            
            results.append({
                'type': 'Meal',
                'time': meal['dt'].strftime('%Y-%m-%d %I:%M %p'),
                'notes': meal.get('notes', 'No description'),
                'carbs': meal.get('carbs', 0),
                'rise': rise,
                'peak': peak
            })

    # Analyze Exercise
    exercise = [t for t in treatments if t['eventType'] == 'Exercise']
    for ex in exercise:
        start_time = ex['dt']
        duration = ex.get('duration', 30)
        end_time = start_time + timedelta(minutes=duration + 60)
        
        window_sgvs = [g['sgv'] for g in glucose_entries if start_time <= g['dt'] <= end_time]
        if window_sgvs:
            pre_ex = [g['sgv'] for g in glucose_entries if start_time - timedelta(minutes=30) <= g['dt'] <= start_time]
            baseline = pre_ex[-1] if pre_ex else window_sgvs[0]
            # Look for the lowest point during or shortly after exercise
            min_val = min(window_sgvs)
            impact = min_val - baseline
            
            results.append({
                'type': 'Exercise',
                'time': ex['dt'].strftime('%Y-%m-%d %I:%M %p'),
                'notes': ex.get('notes', 'No description'),
                'impact': impact,
                'duration': duration
            })

    # Sort results
    top_spikes = sorted([r for r in results if r['type'] == 'Meal'], key=lambda x: x['rise'], reverse=True)[:3]
    top_lowers = sorted([r for r in results if r['type'] == 'Exercise'], key=lambda x: x['impact'])[:3]

    return {
        'top_spikes': top_spikes,
        'exercise_impact': top_lowers,
        'data_meta': {
            'glucose_range': f"{g_dts[0].strftime('%m/%d')} - {g_dts[-1].strftime('%m/%d')}",
            'treatment_range': f"{t_dts[0].strftime('%m/%d')} - {t_dts[-1].strftime('%m/%d')}"
        }
    }

if __name__ == "__main__":
    analysis = analyze_glucose_correlation()
    # If no results due to time gap in sample data, provide an educational hint
    if not analysis['top_spikes'] and not analysis['exercise_impact']:
        print(json.dumps({
            "status": "waiting_for_overlap",
            "hint": "Data found but time ranges don't overlap (Glucose ends 02/24, Treatments start 02/26). Script is ready for the next live data pull.",
            "meta": analysis['data_meta']
        }, indent=2))
    else:
        print(json.dumps(analysis, indent=2))
