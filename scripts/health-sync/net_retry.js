// Retry wrapper for transient DNS-resolution failures.
//
// The mac mini resolves all outbound DNS through a VPN tunnel (utun10 →
// 10.100.0.1). When that tunnel blips, getaddrinfo fails for EVERY external
// host at once — Nightscout, Notion, Telegram alike — and any in-flight cron
// fetch throws `getaddrinfo ENOTFOUND <host>` and aborts the whole run. This
// is what produced the "MySQL glucose sync crashed / Meal outcomes backfill
// crashed" alerts (2026-07-01): the crash was a DNS lookup on the Nightscout
// URL, not a MySQL problem.
//
// These errors happen at name-resolution time, BEFORE any TCP connection is
// made, so the request never reached the server and retrying is completely
// side-effect-free — even for POST/PATCH. We deliberately DO NOT retry
// post-connection errors (ECONNRESET / ETIMEDOUT), which could double-apply a
// non-idempotent write.

const DNS_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);

// Connect-phase failures: the TCP connection was never established, so the
// request never reached the server and a retry cannot double-apply a write.
// Node 18+ Happy Eyeballs surfaces multi-address connect failures as an
// AggregateError whose own .message is EMPTY — the real codes live in .errors.
const CONNECT_ERROR_CODES = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN', 'EADDRNOTAVAIL']);

function isTransientDnsError(err) {
  if (!err) return false;
  if (DNS_ERROR_CODES.has(err.code)) return true;
  // Some layers stringify the cause; match defensively on the message.
  return /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(err.message || '');
}

// DNS errors OR pre-connection connect errors. Safe to retry even POST/PATCH:
// in both cases no bytes reached the server. Do NOT add ECONNRESET/ETIMEDOUT
// here — those can occur after the request was sent.
function isPreConnectionError(err) {
  if (!err) return false;
  if (isTransientDnsError(err)) return true;
  if (CONNECT_ERROR_CODES.has(err.code)) return true;
  if (Array.isArray(err.errors) && err.errors.length > 0) {
    // AggregateError: transient only if EVERY sub-error is a connect failure
    return err.errors.every(e => isPreConnectionError(e));
  }
  return false;
}

// Human-readable message for errors whose .message is empty or unhelpful
// (AggregateError, bare code-only errors). Use in catch-blocks that log.
function describeError(err) {
  if (!err) return 'unknown error';
  if (Array.isArray(err.errors) && err.errors.length > 0) {
    const parts = err.errors.map(e => e.code || e.message || String(e));
    return `${err.code || 'AggregateError'}: [${parts.join(', ')}]`;
  }
  return err.message || err.code || String(err);
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// Runs `factory()` (a function returning a Promise) and retries ONLY on
// transient DNS errors, with exponential backoff + jitter.
//   attempts: total tries          (default 4 → backoffs of ~1s, 2s, 4s)
//   baseMs:   first backoff delay   (default 1000ms)
//   label:    tag for the retry log line
async function withDnsRetry(factory, { attempts = 4, baseMs = 1000, label = 'request' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await factory();
    } catch (err) {
      lastErr = err;
      if (!isTransientDnsError(err) || i === attempts - 1) throw err;
      const delay = baseMs * 2 ** i + Math.floor(Math.random() * 250);
      console.error(`  ↻ ${label}: transient DNS error (${err.code || err.message}); retry ${i + 1}/${attempts - 1} in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// Like withDnsRetry, but also retries connect-phase failures (see
// isPreConnectionError). Still never retries anything that may have reached
// the server.
async function withNetRetry(factory, { attempts = 4, baseMs = 1000, label = 'request' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await factory();
    } catch (err) {
      lastErr = err;
      if (!isPreConnectionError(err) || i === attempts - 1) throw err;
      const delay = baseMs * 2 ** i + Math.floor(Math.random() * 250);
      console.error(`  ↻ ${label}: transient network error (${describeError(err)}); retry ${i + 1}/${attempts - 1} in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

module.exports = { withDnsRetry, withNetRetry, isTransientDnsError, isPreConnectionError, describeError };
