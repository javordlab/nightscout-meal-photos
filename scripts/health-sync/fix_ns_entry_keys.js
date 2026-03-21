const https = require('https');
const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

function nsRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = `${NS_URL}${endpoint}`;
    const data = body ? JSON.stringify(body) : null;
    const options = {
      method,
      headers: {
        'api-secret': NS_SECRET,
        'Content-Type': 'application/json'
      }
    };
    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    
    const req = https.request(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '{}')); } catch { resolve(d); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // Get March 20-21 treatments
  const treatments = await nsRequest('GET', '/api/v1/treatments.json?find[created_at][$gte]=2026-03-20&count=100');
  
  // Find treatments without entry_key marker
  const needsUpdate = treatments.filter(t => {
    return t.notes && !t.notes.includes('[entry_key:');
  });
  
  console.log(`Found ${needsUpdate.length} treatments needing entry_key marker`);
  
  for (const t of needsUpdate.slice(0, 10)) {
    console.log(`\n${t._id} | ${t.created_at} | ${t.notes?.slice(0, 50)}...`);
    
    // Generate entry_key from timestamp and title
    const timestamp = new Date(t.created_at).toISOString();
    // We can't reliably generate entry_key without knowing the original data
    // So we'll just add a marker with the treatment ID for now
    const updatedNotes = `${t.notes} [entry_key:ns_${t._id}]`;
    
    console.log(`Would update to: ${updatedNotes.slice(0, 60)}...`);
  }
}

main().catch(console.error);
