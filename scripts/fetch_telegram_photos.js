const https = require('https');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = '8262629923:AAEdW0HWJN1Y-R32ekvghqrg5bnQydMeop0';
const GROUP_ID = '-5262020908';
const PHOTO_DIR = '/Users/javier/.openclaw/workspace/tmp/telegram_photos';
const STATE_FILE = '/Users/javier/.openclaw/workspace/tmp/telegram_photo_state.json';

// Ensure photo directory exists
if (!fs.existsSync(PHOTO_DIR)) {
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
}

// Load last processed update_id
let lastUpdateId = 0;
if (fs.existsSync(STATE_FILE)) {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  lastUpdateId = state.lastUpdateId || 0;
}

function telegramApi(method, params = {}) {
  return new Promise((resolve, reject) => {
    const queryParams = new URLSearchParams(params).toString();
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}${queryParams ? '?' + queryParams : ''}`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    }).on('error', reject);
  });
}

function downloadFile(fileId, outputPath) {
  return new Promise((resolve, reject) => {
    // First get file path
    telegramApi('getFile', { file_id: fileId }).then(result => {
      if (!result.ok || !result.result?.file_path) {
        reject(new Error('Failed to get file path'));
        return;
      }
      
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${result.result.file_path}`;
      const file = fs.createWriteStream(outputPath);
      
      https.get(fileUrl, (res) => {
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(outputPath);
        });
      }).on('error', reject);
    }).catch(reject);
  });
}

async function main() {
  console.log('Fetching updates from Telegram...');
  
  const updates = await telegramApi('getUpdates', { 
    offset: lastUpdateId + 1,
    limit: 100
  });
  
  if (!updates.ok) {
    console.error('Failed to fetch updates:', updates);
    return;
  }
  
  if (!updates.result.length) {
    console.log('No new messages');
    return;
  }
  
  const photos = [];
  
  for (const update of updates.result) {
    const msg = update.message;
    if (!msg) continue;
    
    // Update last processed ID
    if (update.update_id > lastUpdateId) {
      lastUpdateId = update.update_id;
    }
    
    // Only process messages from the Food log group
    if (msg.chat?.id.toString() !== GROUP_ID) continue;
    
    // Check for photos
    if (msg.photo && msg.photo.length > 0) {
      // Get largest photo
      const photo = msg.photo[msg.photo.length - 1];
      const date = new Date(msg.date * 1000).toISOString().split('T')[0];
      const filename = `${date}_${msg.message_id}.jpg`;
      const outputPath = path.join(PHOTO_DIR, filename);
      
      // Skip if already downloaded
      if (fs.existsSync(outputPath)) {
        console.log(`Skipping existing: ${filename}`);
        continue;
      }
      
      console.log(`Downloading: ${filename}`);
      try {
        await downloadFile(photo.file_id, outputPath);
        photos.push({
          filename,
          path: outputPath,
          date: new Date(msg.date * 1000).toISOString(),
          caption: msg.caption || '',
          messageId: msg.message_id
        });
      } catch (e) {
        console.error(`Failed to download ${filename}:`, e.message);
      }
    }
  }
  
  // Save state
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastUpdateId, lastRun: new Date().toISOString() }, null, 2));
  
  // Save photo manifest
  if (photos.length > 0) {
    const manifestPath = path.join(PHOTO_DIR, 'manifest.json');
    let manifest = [];
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
    manifest.push(...photos);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\nDownloaded ${photos.length} new photos`);
  } else {
    console.log('No new photos to download');
  }
}

main().catch(console.error);
