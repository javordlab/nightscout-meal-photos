const fs = require('fs');
const https = require('https');
const path = require('path');

const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const NOTION_KEY = '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';
const WORKSPACE = '/Users/javier/.openclaw/workspace';

// The three dinner photos with correct timestamps
const DINNERS = [
  {
    timestamp: '2026-03-20T18:45:00-07:00', // 6:45 PM PDT
    photoUrl: 'PLACEHOLDER_FOR_DUMPLINGS', // Need actual URL
    description: 'Dinner: Four steamed dumplings with savory side dishes',
    carbs: 45,
    cals: 400
  },
  {
    timestamp: '2026-03-20T19:00:00-07:00', // 7:00 PM PDT
    photoUrl: 'https://iili.io/qeh3GSI.jpg', // milk
    description: 'Dinner: Glass of milk',
    carbs: 12,
    cals: 150
  },
  {
    timestamp: '2026-03-20T19:15:00-07:00', // 7:15 PM PDT
    photoUrl: 'https://iili.io/qeh6rzX.jpg', // chocolate
    description: 'Dinner: Small piece of chocolate/brownie',
    carbs: 8,
    cals: 70
  }
];

// Update health_log.md
function updateHealthLog() {
  const logPath = path.join(WORKSPACE, 'health_log.md');
  let content = fs.readFileSync(logPath, 'utf8');
  
  // Remove the wrong entries (March 21 01:45 and 02:00 dinners)
  const lines = content.split('\n');
  const corrected = lines.filter(line => {
    // Keep all lines except the wrong March 21 dinner entries
    if (line.includes('2026-03-21') && line.includes('Dinner')) {
      return false;
    }
    return true;
  });
  
  // Find where to insert the new entries (after March 20 entries)
  let insertIndex = corrected.findIndex(line => line.includes('2026-03-20') && line.includes('Lunch:'));
  while (insertIndex < corrected.length && corrected[insertIndex]?.includes('2026-03-20')) {
    insertIndex++;
  }
  
  // Add the three correct dinner entries
  const newEntries = DINNERS.map(d => {
    const date = d.timestamp.slice(0, 10);
    const time = d.timestamp.slice(11, 16) + ' ' + d.timestamp.slice(-6);
    return `| ${date} | ${time} | Maria Dennis | Food | Dinner | ${d.description} [📷](${d.photoUrl}) | ${d.carbs} | ${d.cals} |`;
  });
  
  corrected.splice(insertIndex, 0, ...newEntries);
  
  fs.writeFileSync(logPath, corrected.join('\n'));
  console.log('Updated health_log.md');
}

// Update sync_state
function updateSyncState() {
  const statePath = path.join(WORKSPACE, 'data/sync_state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  
  // Remove wrong entries
  Object.keys(state.entries).forEach(key => {
    const e = state.entries[key];
    if (e.timestamp?.startsWith('2026-03-21T0') && e.title?.includes('Dinner')) {
      delete state.entries[key];
    }
  });
  
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log('Updated sync_state.json');
}

// Archive wrong Notion pages
async function archiveWrongNotionPages() {
  const wrongPageIds = [
    // The March 21 dinner pages
    '32a85ec7-0668-81fb-bba3-f195092cae25', // 2:00 AM
    '32a85ec7-0668-81e4-97fb-e1e2ac9c789b', // 1:45 AM
  ];
  
  for (const pageId of wrongPageIds) {
    const data = JSON.stringify({ archived: true });
    const options = {
      hostname: 'api.notion.com',
      path: `/v1/pages/${pageId}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    await new Promise((resolve) => {
      const req = https.request(options, (res) => {
        res.on('end', () => resolve());
        res.on('data', () => {});
      });
      req.on('error', resolve);
      req.write(data);
      req.end();
    });
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('Archived wrong Notion pages');
}

// Delete wrong Nightscout treatments
async function deleteWrongNSTreatments() {
  const treatmentIds = [
    '69bdfc86911a8ea261e673f1', // 2:00 AM
    '69bdf8ad911a8ea261e673ed', // 1:45 AM
  ];
  
  for (const id of treatmentIds) {
    const options = {
      method: 'DELETE',
      headers: { 'api-secret': NS_SECRET }
    };
    await new Promise((resolve) => {
      https.request(`${NS_URL}/api/v1/treatments/${id}.json`, options, (res) => {
        res.on('end', () => resolve());
        res.on('data', () => {});
      }).on('error', resolve).end();
    });
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('Deleted wrong Nightscout treatments');
}

async function main() {
  console.log('Fixing dinner entries...\n');
  
  updateHealthLog();
  updateSyncState();
  await archiveWrongNotionPages();
  await deleteWrongNSTreatments();
  
  console.log('\nDone. Now run the health sync pipeline to create correct entries.');
}

main().catch(console.error);
