import json
from datetime import datetime, timedelta, timezone

def calculate_gmi(mean_glucose):
    return 3.31 + (0.02392 * mean_glucose)

def get_pst_time(utc_dt):
    # PST is UTC-8
    return utc_dt.astimezone(timezone(timedelta(hours=-8)))

def process_data():
    with open('glucose_data.json', 'r') as f:
        entries = json.load(f)
    
    with open('treatments_data.json', 'r') as f:
        treatments = json.load(f)

    # Current time in UTC (for filtering)
    now_utc = datetime.now(timezone.utc)
    
    # 24h ago
    period_1_start = now_utc - timedelta(hours=24)
    # 48h ago
    period_2_start = now_utc - timedelta(hours=48)
    # 14 days ago
    period_14d_start = now_utc - timedelta(days=14)

    p1_values = []
    p2_values = []
    p14d_values = []
    
    outliers = []

    for entry in entries:
        dt = datetime.fromisoformat(entry['dateString'].replace('Z', '+00:00'))
        sgv = entry.get('sgv')
        if sgv is None: continue
        
        if dt >= period_1_start:
            p1_values.append(sgv)
            if sgv > 250 or sgv < 70:
                outliers.append((dt, sgv))
        elif dt >= period_2_start:
            p2_values.append(sgv)
        
        if dt >= period_14d_start:
            p14d_values.append(sgv)

    # 1. 24-hour summary
    avg_p1 = sum(p1_values) / len(p1_values) if p1_values else 0
    tir_p1 = (len([v for v in p1_values if 70 <= v <= 180]) / len(p1_values) * 100) if p1_values else 0
    gmi_p1 = calculate_gmi(avg_p1)

    # 2. 14-day rolling GMI
    avg_14d = sum(p14d_values) / len(p14d_values) if p14d_values else 0
    gmi_14d = calculate_gmi(avg_14d)

    # 3. Trends
    avg_p2 = sum(p2_values) / len(p2_values) if p2_values else 0
    if avg_p1 < avg_p2 - 5:
        trend = "Improving (Lower average)"
    elif avg_p1 > avg_p2 + 5:
        trend = "Declining (Higher average)"
    else:
        trend = "Stable"

    # 4. Outliers
    outlier_reports = []
    for dt, sgv in outliers:
        pst_time = get_pst_time(dt).strftime('%I:%M %p')
        type_str = "Spike" if sgv > 250 else "Low"
        outlier_reports.append(f"- {type_str}: {sgv} mg/dL at {pst_time} PST")

    # 5. Reality Check & Recommendations
    # Find treatments in the last 24h
    recent_treatments = [t for t in treatments if datetime.fromisoformat(t['created_at'].replace('Z', '+00:00')) >= period_1_start]
    
    # Generate report
    report = f"""Maria's Daily Health Brief 📊
Date: {get_pst_time(now_utc).strftime('%A, %B %d, %Y')}

Summary (Last 24 Hours):
- Average Glucose: {avg_p1:.1f} mg/dL
- Time In Range (70-180): {tir_p1:.1f}%
- Estimated GMI (A1c): {gmi_p1:.2f}%

Historical Context:
- 14-Day Rolling GMI: {gmi_14d:.2f}%
- Trend vs. Previous 24h: {trend}

Outliers & Significant Events:
{chr(10).join(outlier_reports) if outlier_reports else "No significant outliers detected! Great stability."}

Reality Check Analysis:
"""
    # Recommendations logic
    if tir_p1 > 80:
        report += "Excellent control! You've stayed in range for the vast majority of the day. Keep up the consistent meal timing and monitoring.\n"
    elif tir_p1 > 60:
        report += "Good effort. To improve your TIR, consider reviewing the carb counts for meals that led to spikes and ensure bolusing happens 15-20 mins before eating.\n"
    else:
        report += "It's been a challenging day. Focus on returning to baseline stability. Check if any recent meals had hidden sugars or if stress/activity levels changed unexpectedly.\n"

    if any(v < 70 for v in p1_values):
        report += "\nRecommendation: Review the timing of your activity relative to insulin. Lows can often be prevented by a small snack before exercise.\n"
    
    if any(v > 250 for v in p1_values):
        report += "\nRecommendation: Those spikes suggest we might need to look at pre-bolus times or high-glycemic index foods. Try adding more fiber/protein to dampen the curves.\n"

    report += "\nStay positive—every day is a new opportunity to fine-tune. You're doing the hard work that pays off in the long run! 💪✨"
    
    print(report)

if __name__ == "__main__":
    process_data()
