#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const DATA_DIR = path.join(WORKSPACE, 'data');
const RAW_UPDATES_PATH = path.join(DATA_DIR, 'telegram_updates_raw.jsonl');
const OUT_PATH = path.join(DATA_DIR, 'telegram_media_envelopes.jsonl');
const STATE_PATH = path.join(DATA_DIR, 'telegram_media_state.json');

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { lastClassifiedUpdateId: 0 };
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    if (!Number.isFinite(parsed.lastClassifiedUpdateId)) parsed.lastClassifiedUpdateId = 0;
    return parsed;
  } catch {
    return { lastClassifiedUpdateId: 0 };
  }
}

function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function classifyMessage(msg) {
  const hasText = Boolean(msg.text && String(msg.text).trim());
  const hasCaption = Boolean(msg.caption && String(msg.caption).trim());
  const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
  const hasDocument = Boolean(msg.document);
  const hasVoice = Boolean(msg.voice);
  const hasAudio = Boolean(msg.audio);
  const hasVideo = Boolean(msg.video);

  if (hasPhoto && (hasText || hasCaption)) return 'PHOTO_TEXT';
  if (hasPhoto) return 'PHOTO';

  if (hasDocument) {
    const mime = String(msg.document.mime_type || '').toLowerCase();
    const fileName = String(msg.document.file_name || '').toLowerCase();
    const isImage = mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic|heif)$/.test(fileName);
    if (isImage) return 'IMAGE_DOCUMENT';
    return 'DOCUMENT_NON_IMAGE';
  }

  if (hasVoice || hasAudio) return 'VOICE';
  if (hasVideo) return 'VIDEO';
  if (hasText) return 'TEXT';
  return 'UNSUPPORTED_MEDIA';
}

function mediaKindForType(contentType) {
  if (['PHOTO', 'PHOTO_TEXT', 'IMAGE_DOCUMENT'].includes(contentType)) return 'image';
  if (contentType === 'VOICE') return 'audio';
  if (contentType === 'VIDEO') return 'video';
  if (contentType === 'DOCUMENT_NON_IMAGE') return 'document';
  return 'none';
}

function pickFileFields(msg, contentType) {
  if (contentType === 'PHOTO' || contentType === 'PHOTO_TEXT') {
    const photo = msg.photo[msg.photo.length - 1] || {};
    return {
      fileId: photo.file_id || null,
      fileUniqueId: photo.file_unique_id || null,
      mimeType: 'image/jpeg',
      fileName: null
    };
  }
  if (contentType === 'IMAGE_DOCUMENT' || contentType === 'DOCUMENT_NON_IMAGE') {
    const d = msg.document || {};
    return {
      fileId: d.file_id || null,
      fileUniqueId: d.file_unique_id || null,
      mimeType: d.mime_type || null,
      fileName: d.file_name || null
    };
  }
  if (contentType === 'VOICE') {
    const v = msg.voice || msg.audio || {};
    return {
      fileId: v.file_id || null,
      fileUniqueId: v.file_unique_id || null,
      mimeType: v.mime_type || null,
      fileName: v.file_name || null
    };
  }
  if (contentType === 'VIDEO') {
    const v = msg.video || {};
    return {
      fileId: v.file_id || null,
      fileUniqueId: v.file_unique_id || null,
      mimeType: v.mime_type || null,
      fileName: v.file_name || null
    };
  }
  return { fileId: null, fileUniqueId: null, mimeType: null, fileName: null };
}

function toEnvelope(update) {
  const msg = update.message || update.edited_message || update.channel_post;
  if (!msg) return null;

  const contentType = classifyMessage(msg);
  const fileFields = pickFileFields(msg, contentType);
  const timestamp = new Date((msg.date || 0) * 1000).toISOString();

  return {
    envelopeId: `${update.update_id}:${msg.message_id}`,
    updateId: update.update_id,
    messageId: msg.message_id,
    chatId: msg.chat?.id ?? null,
    senderId: msg.from?.id ?? null,
    timestamp,
    contentType,
    mediaKind: mediaKindForType(contentType),
    captionOrText: msg.caption || msg.text || '',
    ...fileFields
  };
}

function loadRawUpdates() {
  if (!fs.existsSync(RAW_UPDATES_PATH)) return [];
  const lines = fs.readFileSync(RAW_UPDATES_PATH, 'utf8').split('\n').filter(Boolean);
  const updates = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (!obj || !Number.isFinite(obj.update_id)) continue;
      updates.push(obj);
    } catch {
      // ignore malformed line
    }
  }
  updates.sort((a, b) => a.update_id - b.update_id);
  return updates;
}

function appendEnvelopes(envelopes) {
  if (!envelopes.length) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const lines = envelopes.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.appendFileSync(OUT_PATH, lines);
}

async function main() {
  const state = loadState();
  const updates = loadRawUpdates();
  const startId = Number(state.lastClassifiedUpdateId || 0);

  const pending = updates.filter((u) => u.update_id > startId);
  const envelopes = [];
  let maxUpdateId = startId;

  for (const update of pending) {
    if (update.update_id > maxUpdateId) maxUpdateId = update.update_id;
    const env = toEnvelope(update);
    if (!env) continue;
    envelopes.push(env);
  }

  appendEnvelopes(envelopes);

  saveState({
    ...state,
    lastClassifiedUpdateId: maxUpdateId,
    lastRun: new Date().toISOString(),
    appended: envelopes.length
  });

  const summary = { appended: envelopes.length, lastClassifiedUpdateId: maxUpdateId };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main, classifyMessage, toEnvelope };
