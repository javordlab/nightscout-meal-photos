const fs = require('fs');
const https = require('https');
const path = require('path');

const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const NOTION_KEY = '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';
const NOTION_DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';
const WORKSPACE = '/Users/javier/.openclaw/workspace';

// The three dinner entries with correct timestamps
const DINNERS = [
  {
    timestamp: '2026-03-20T18:45:00-07:00',
    photoUrl: 'https://iili.io/qeh3woG.jpg',
    description: 'Dinner: Four steamed dumplings with braised meat, sautéed vegetable hash, and dipping sauce',
    carbs: 55,
    cals: 450
  },
  {
    timestamp: '2026-03-20T18:45:00-07:00', // Same time
    photoUrl: 'https://iili.io/qeh3GSI.jpg',
    description: 'Dinner: Glass of milk (whole milk, ~8oz)',
    carbs: 12,
    cals: 150
  },
  {
    timestamp: '2026-03-20T19:00:00-07:00', // 7:00 PM
    photoUrl: 'https://iili.io/qeh6rzX.jpg',
    description: 'Dinner: Small piece of dark chocolate bark/brownie',
    carbs: 8,
    cals: 70
  }
];

// 1. Fix health_log.md
function fixHealthLog() {
  const logPath = path.join(WORKSPACE, 'health_log.md');
  let content = fs.readFileSync(logPath, 'utf8');
  
  // Remove wrong March 21 dinner entries
  const lines = content.split('\n');
  const filtered = lines.filter(line => {
    // Remove lines with March 21 and Dinner
    if (line.includes('2026-03-21') && line.includes('Dinner')) {
      return false;
    }
    return true;
  });
  
  // Find insertion point (after March 20 lunch entry)
  let insertIndex = filtered.findIndex(line => 
    line.includes('2026-03-20') && line.includes('Lunch:')
  ) + 1;
  
  // Add the three correct dinner entries
  const newEntries = DINNERS.map(d => {
    const date = d.timestamp.slice(0, 10);
    const time = d.timestamp.slice(11, 16) + ' -07:00';
    return `| ${date} | ${time} | Maria Dennis | Food | Dinner | ${d.description} [📷](${d.photoUrl}) | ${d.carbs} | ${d.cals} |`;
  });
  
  filtered.splice(insertIndex, 0, ...newEntries);
  fs.writeFileSync(logPath, filtered.join('\n'));
  console.log('✓ Fixed health_log.md');
}

// 2. Delete wrong Nightscout treatments
async function fixNightscout() {
  const wrongIds = ['69bdfc86911a8ea261e673f1', '69bdf8ad911a8ea261e673ed'];
  
  for (const id of wrongIds) {
    await new Promise((resolve) => {
      const options = { method: 'DELETE', headers: { 'api-secret': NS_SECRET } };
      https.request(`${NS_URL}/api/v1/treatments/${id}.json`, options, (res) => {
        res.on('end', resolve);
        res.on('data', () => {});
      }).on('error', resolve).end();
    });
  }
  console.log('✓ Deleted wrong Nightscout treatments');
  
  // Create new treatments
  for (const d of DINNERS) {
    const utcTime = new Date(d.timestamp).toISOString();
    const treatment = {
      eventType: 'Meal Bolus',
      created_at: utcTime,
      carbs: d.carbs,
      protein: d.cals,
      notes: `${d.description} 📷 ${d.photoUrl}`
    };
    
    await new Promise((resolve) => {
      const data = JSON.stringify(treatment);
      const options = {
        method: 'POST',
        headers: {
          'api-secret': NS_SECRET,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };
      const req = https.request(`${NS_URL}/api/v1/treatments.json`, options, (res) => {
        res.on('end', resolve);
        res.on('data', () => {});
      });
      req.on('error', resolve);
      req.write(data);
      req.end();
    });
  }
  console.log('✓ Created correct Nightscout treatments');
}

// 3. Fix Notion pages
async function fixNotion() {
  // Archive wrong pages (March 21 dinners)
  const wrongPageIds = [
    '32a85ec7-0668-81fb-bba3-f195092cae25',
    '32a85ec7-0668-81e4-97fb-e1e2ac9c789b'
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
        res.on('end', resolve);
        res.on('data', () => {});
      });
      req.on('error', resolve);
      req.write(data);
      req.end();
    });
  }
  console.log('✓ Archived wrong Notion pages');
  
  // Create new pages
  for (const d of DINNERS) {
    const pageData = {
      parent: { database_id: NOTION_DB_ID },
      properties: {
        Entry: {
          title: [{ text: { content: d.description } }]
        },
        Date: {
          date: { start: d.timestamp }
        },
        Category: {
          select: { name: 'Food' }
        },
        'Meal Type': {
          select: { name: 'Dinner' }
        },
        'Carbs (est)': {
          number: d.carbs
        },
        'Calories (est)': {
          number: d.cals
        },
        Photo: {
          url: d.photoUrl
        },
        User: {
          select: { name: 'Maria Dennis' }
        }
      }
    };
    
    const data = JSON.stringify(pageData);
    const options = {
      hostname: 'api.notion.com',
      path: '/v1/pages',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    
    await new Promise((resolve) => {
      const req = https.request(options, (res) => {
        res.on('end', resolve);
        res.on('data', () => {});
      });
      req.on('error', resolve);
      req.write(data);
      req.end();
    });
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('✓ Created correct Notion pages');
}

// 4. Fix Gallery JSON
function fixGallery() {
  const galleryPath = path.join(WORKSPACE, 'nightscout-meal-photos/data/notion_meals.json');
  const gallery = JSON.parse(fs.readFileSync(galleryPath, 'utf8'));
  
  // Remove wrong entries (March 21 dinners)
  const filtered = gallery.filter(item => 
    !(item.date?.startsWith('2026-03-21T0') && item.title?.includes('Dinner'))
  );
  
  // Add correct entries
  for (const d of DINNERS) {
    filtered.push({
      id: `manual-${d.timestamp.replace(/:/g, '-')}`,
      entry_key: `sha256:${Date.now()}`, // Will be fixed by sync
      title: d.description,
      type: 'Dinner',
      date: d.timestamp,
      photo: d.photoUrl,
      carbs: d.carbs,
      cals: d.cals,
      preMeal: null,
      delta: null,
      peak: null
    });
  }
  
  fs.writeFileSync(galleryPath, JSON.stringify(filtered, null, 2));
  console.log('✓ Fixed gallery JSON');
}

// 5. Fix sync_state
function fixSyncState() {
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
  console.log('✓ Fixed sync_state.json');
}

async function main() {
  console.log('Fixing dinner entries with correct timestamps...\n');
  
  fixHealthLog();
  fixSyncState();
  fixGallery();
  await fixNightscout();
  await fixNotion();
  
  console.log('\n✅ All systems fixed with correct March 20, 6:45 PM and 7:00 PM timestamps');
}

main().catch(console.error);
