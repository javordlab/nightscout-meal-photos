const { describe, it } = require('node:test');
const assert = require('node:assert');

const { classifyMessage, toEnvelope } = require('../../scripts/telegram_classify_updates');

describe('telegram classifier', () => {
  it('classifies native photo as PHOTO', () => {
    const msg = { photo: [{ file_id: '1', file_unique_id: 'u1' }] };
    assert.strictEqual(classifyMessage(msg), 'PHOTO');
  });

  it('classifies image document as IMAGE_DOCUMENT', () => {
    const msg = {
      document: {
        file_id: '2',
        file_unique_id: 'u2',
        mime_type: 'image/jpeg',
        file_name: 'meal.jpg'
      }
    };
    assert.strictEqual(classifyMessage(msg), 'IMAGE_DOCUMENT');
  });

  it('classifies voice as VOICE', () => {
    const msg = { voice: { file_id: '3', file_unique_id: 'u3', mime_type: 'audio/ogg' } };
    assert.strictEqual(classifyMessage(msg), 'VOICE');
  });

  it('builds normalized envelope with file metadata', () => {
    const update = {
      update_id: 100,
      message: {
        message_id: 3267,
        date: 1774296092,
        chat: { id: -5262020908 },
        from: { id: 8738167445 },
        document: {
          file_id: 'file_x',
          file_unique_id: 'uniq_x',
          mime_type: 'image/jpeg',
          file_name: 'photo.jpg'
        }
      }
    };

    const env = toEnvelope(update);
    assert.strictEqual(env.contentType, 'IMAGE_DOCUMENT');
    assert.strictEqual(env.mediaKind, 'image');
    assert.strictEqual(env.messageId, 3267);
    assert.strictEqual(env.fileId, 'file_x');
    assert.strictEqual(env.fileUniqueId, 'uniq_x');
  });
});
