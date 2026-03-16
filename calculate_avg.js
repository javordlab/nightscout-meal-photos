const fetch = require('node-fetch');
const start = '2026-03-15T07:00:00.000Z';
const end = '2026-03-16T07:00:00.000Z';
const url = `https://p01--sefi--s66fclg7g2lm.code.run/api/v1/entries/sgv.json?count=1000&find[dateString][$gte]=${start}&find[dateString][$lte]=${end}`;

async function run() {
  const res = await fetch(url);
  const data = await res.json();
  const values = data.map(e => e.sgv);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  console.log('Count:', values.length);
  console.log('Average:', avg);
  console.log('First:', data[0].dateString);
  console.log('Last:', data[data.length-1].dateString);
}
run();
