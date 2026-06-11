const { fetchRecentSgvRows } = require('./lib/glucose_source');

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const MIN_14D_COVERAGE_DAYS = 13;

function laDateString(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function addDays(dateString, delta) {
    const dt = new Date(`${dateString}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + delta);
    return dt.toISOString().slice(0, 10);
}

async function main() {
    const sgvRows = fetchRecentSgvRows(5000);

    const today = laDateString(new Date());
    const prevDay = addDays(today, -1);
    const start14 = addDays(prevDay, -13);

    const rows14d = sgvRows.filter(e => {
        const d = laDateString(new Date(e.date));
        return d >= start14 && d <= prevDay;
    });
    const coverageDays = new Set(rows14d.map(e => laDateString(new Date(e.date)))).size;

    if (coverageDays < MIN_14D_COVERAGE_DAYS) {
        console.log(JSON.stringify({
            error: 'insufficient_coverage',
            message: `Only ${coverageDays} distinct days of CGM data available in the 14-day window (need ${MIN_14D_COVERAGE_DAYS}). 14-day stats not produced.`,
            window: { start: start14, end: prevDay },
            coverageDays
        }, null, 2));
        process.exit(2);
    }

    const values = rows14d.map(e => e.sgv);
    const sum = values.reduce((a, b) => a + b, 0);
    const average = sum / values.length;
    const tir = (values.filter(v => v >= 70 && v <= 180).length / values.length) * 100;
    const gmi = 3.31 + (0.02392 * average);

    const squareDiffs = values.map(v => Math.pow(v - average, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
    const stdDev = Math.sqrt(avgSquareDiff);
    const cv = (stdDev / average) * 100;

    console.log(JSON.stringify({
        window: { start: start14, end: prevDay },
        coverageDays,
        count: values.length,
        average: Math.round(average),
        tir: tir.toFixed(1),
        gmi: gmi.toFixed(1),
        stdDev: Math.round(stdDev),
        cv: cv.toFixed(1)
    }, null, 2));
}

main().catch(err => {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
});
