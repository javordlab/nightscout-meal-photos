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

function calculateStats(values) {
    if (values.length === 0) return null;
    const sum = values.reduce((a, b) => a + b, 0);
    const average = sum / values.length;
    const tir = (values.filter(v => v >= 70 && v <= 180).length / values.length) * 100;
    const gmi = 3.31 + (0.02392 * average);
    return { average, tir, gmi, count: values.length };
}

async function main() {
    const sgvRows = fetchRecentSgvRows(5000);

    const today = laDateString(new Date());
    const prevDay = addDays(today, -1);
    const start14 = addDays(prevDay, -13);

    const values24h = sgvRows
        .filter(e => laDateString(new Date(e.date)) === prevDay)
        .map(e => e.sgv);

    const rows14d = sgvRows.filter(e => {
        const d = laDateString(new Date(e.date));
        return d >= start14 && d <= prevDay;
    });
    const coverageDays = new Set(rows14d.map(e => laDateString(new Date(e.date)))).size;
    const values14d = rows14d.map(e => e.sgv);

    const stats24h = calculateStats(values24h);
    const stats14d = coverageDays >= MIN_14D_COVERAGE_DAYS
        ? calculateStats(values14d)
        : null;

    const output = {
        window: { targetDay: prevDay, start14, end14: prevDay },
        stats24h,
        stats14d,
        coverage: {
            days14d: coverageDays,
            required14d: MIN_14D_COVERAGE_DAYS,
            sufficient14d: coverageDays >= MIN_14D_COVERAGE_DAYS
        }
    };

    console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
});
