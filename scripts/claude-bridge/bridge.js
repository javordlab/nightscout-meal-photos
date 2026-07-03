#!/usr/bin/env node
/**
 * claude-bridge/bridge.js
 * Telegram → Claude Code bridge for Javi's DM.
 * Routes messages (text + photos) to `claude --print` with AGENTS.md system prompt,
 * maintaining a persistent session per user.
 * Falls back to Ollama cloud (DeepSeek V3.2) if Claude is unavailable.
 *
 * Maria's messages go through OpenClaw (separate bot). This bridge is Javi-only.
 *
 * Commands:
 *   /reset   — start a fresh Claude Code session
 *   /status  — show current session ID + model
 *   /help    — show available commands
 */

const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const execAsync = promisify(exec);

// ── Config ─────────────────────────────────────────────────────────────────
// Multi-instance support (added 2026-04-06): bridge.js can be run as several
// independent processes, each with its own bot, model, backend, state, and log.
// Pass BRIDGE_CONFIG=/path/to/config.<instance>.json (or argv[2]) to select.
// If neither is set, fall back to ./config.json for backwards compat with the
// original single-instance "cc_mini" cc_mini Sonnet bridge.
const CONFIG_PATH = process.env.BRIDGE_CONFIG
  || process.argv[2]
  || path.join(__dirname, 'config.json');
const config = require(CONFIG_PATH);

const INSTANCE_LABEL = config.instanceLabel || 'main';
const BOT_TOKEN = process.env.CLAUDE_BRIDGE_TOKEN || config.botToken;
const MODEL = process.env.CLAUDE_BRIDGE_MODEL || config.model || 'sonnet';
// Optional reasoning effort level passed as `--effort <level>` to claude-cli.
// Valid values: low | medium | high | xhigh | max. Unset = CLI default.
// Applies to both primary model and any claude-cli fallback tiers.
const EFFORT = process.env.CLAUDE_BRIDGE_EFFORT || config.effort || null;
// Backend selects how a turn is executed:
//   'claude-cli'     → spawn /Users/javier/.local/bin/claude -p --model <model>
//                      (uses Claude Code subscription OAuth — for sonnet/haiku/opus)
//   'openclaw-agent' → spawn `openclaw agent --agent <agentId> -m <prompt> --json`
//                      (uses OpenClaw routing + that agent's configured model — for codex)
const BACKEND = config.backend || 'claude-cli';
const OPENCLAW_AGENT_ID = config.agentId || null; // required when BACKEND === 'openclaw-agent'
const ALLOWED_USERS = config.allowedUsers || [8335333215, 8738167445]; // Javi + Maria

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const CLAUDE_BIN = '/Users/javier/.local/bin/claude';
const OPENCLAW_BIN = '/opt/homebrew/bin/openclaw';
const INBOUND_DIR = '/Users/javier/.openclaw/media/inbound';
const SYSTEM_PROMPT_FILE = config.systemPromptFile || path.join(WORKSPACE, 'AGENTS.md');
// Optional per-config working directory for the spawned `claude` process.
// If unset, defaults to WORKSPACE. Use this to give a bridge instance an
// isolated cwd with its own minimal CLAUDE.md so Claude Code's auto-discovery
// only loads what that instance needs (massive context savings on small bots).
const CLAUDE_CWD = config.claudeCwd
  ? (path.isAbsolute(config.claudeCwd) ? config.claudeCwd : path.join(WORKSPACE, config.claudeCwd))
  : WORKSPACE;
// Optional setting-sources override. When set (e.g. "project"), the bridge passes
// `--setting-sources <value>` to claude --print so the user's global ~/.claude/settings.json
// is NOT loaded for bridge sessions. Combined with a project-scoped .claude/settings.json
// in CLAUDE_CWD, this lets a bridge instance have its own hooks/permissions without
// touching the user's interactive Claude Code config.
const SETTING_SOURCES = config.settingSources || null;
// Optional post-reply detached command. After a successful agent reply, the bridge
// spawns this command fully detached (`spawn` with detached:true, stdio:'ignore', .unref()).
// Use this for tasks that should run independently of the user-facing reply (e.g.
// radial_dispatcher.js to sync health_log changes to Notion/Nightscout). Format:
// { cmd: "node", args: ["scripts/foo.js"], cwd: "/path" }. The cwd defaults to WORKSPACE.
const POST_REPLY_DETACHED = config.postReplyDetached || null;
// Optional default prompt for messages that contain a photo but no text caption.
// Defaults to "What do you see in this photo?" (Javi DM bridge semantics). For
// food-log bridges, set this to a workflow-triggering instruction so the agent
// runs the full food-log workflow on photo-only messages instead of just describing.
const DEFAULT_PHOTO_PROMPT = config.defaultPhotoPrompt || 'What do you see in this photo?';

// Optional: upload incoming photos to freeimage.host BEFORE invoking the agent,
// so the agent receives a ready-to-paste URL instead of having to curl from
// inside its bash step. Opt-in (food-log bridge only) to keep other bridges
// unaffected. See foodlog-cwd/CLAUDE.md for the matching agent-side instruction.
const UPLOAD_PHOTO_BEFORE_AGENT = config.uploadPhotoBeforeAgent === true;
const FREEIMAGE_KEY   = config.freeimageKey || '6d207e02198a847aa98d0a2a901485a5';
const UPLOAD_LOG      = path.join(WORKSPACE, 'data/photo_upload_log.jsonl');
const UPLOAD_TIMEOUT_S = 25;  // per attempt
const UPLOAD_ATTEMPTS  = 2;   // 1 try + 1 retry

async function uploadPhotoToFreeimage(filePath) {
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      const { stdout } = await execAsync(
        `/usr/bin/curl -s -X POST "https://freeimage.host/api/1/upload" ` +
        `-F "key=${FREEIMAGE_KEY}" -F "source=@${filePath}" --max-time ${UPLOAD_TIMEOUT_S}`,
        { timeout: (UPLOAD_TIMEOUT_S + 5) * 1000, maxBuffer: 2 * 1024 * 1024 }
      );
      const o = JSON.parse(stdout);
      const url = o && o.image && o.image.url;
      if (url) {
        try {
          fs.appendFileSync(UPLOAD_LOG, JSON.stringify({
            photoPath: filePath,
            iiliUrl: url,
            uploadedAt: new Date().toISOString(),
            source: `bridge_upload_${INSTANCE_LABEL}`,
          }) + '\n');
        } catch (e) { log(`upload_log append failed: ${e.message}`); }
        return url;
      }
    } catch (e) {
      log(`freeimage upload attempt ${attempt}/${UPLOAD_ATTEMPTS} failed: ${e.message}`);
    }
  }
  return null;
}

// State + log default to instance-suffixed names IF instanceLabel is provided
// (so multi-instance launches don't clobber each other), or to the legacy
// unsuffixed names if not (so the original cc_mini bridge keeps working).
const STATE_FILE = config.stateFile
  ? path.join(WORKSPACE, config.stateFile)
  : (config.instanceLabel
      ? path.join(WORKSPACE, `data/claude_bridge_state_${INSTANCE_LABEL}.json`)
      : path.join(WORKSPACE, 'data/claude_bridge_state.json'));
const LOG_FILE = config.logFile
  ? path.join(WORKSPACE, config.logFile)
  : (config.instanceLabel
      ? path.join(WORKSPACE, `data/claude_bridge_${INSTANCE_LABEL}.log`)
      : path.join(WORKSPACE, 'data/claude_bridge.log'));

const POLL_INTERVAL_MS = 1500;
const MAX_MESSAGE_LENGTH = 4096; // Telegram limit

// Multi-backend fallback chain (replaces the old Ollama-only fallback list on 2026-04-08).
// Each tier is a {backend, model?, agentId?} object. The bridge tries them in order
// when the primary backend fails. Supported backends:
//   - 'claude-cli'     → spawn `claude --print --model <model>` (full Claude Code tool surface, vision, etc.)
//   - 'openclaw-agent' → spawn `openclaw agent --agent <agentId>` (uses that agent's configured model + tools)
//   - 'ollama'         → POST to local Ollama HTTP /api/chat (text only, no tools — vision via base64 image array if model supports it)
//   - 'codex-cli'      → spawn `codex exec` (OpenAI Codex CLI, ChatGPT-subscription OAuth; read-only sandbox, vision via -i, no file writes)
//
// Default order is intentionally Haiku → Codex → Gemini → DeepSeek:
//   tier 1 (Haiku via claude-cli)        — same tool surface as primary, vision-capable, free under Max, much higher rate limits than Sonnet
//   tier 2 (Codex via openclaw-agent)    — different provider (OpenAI ChatGPT Plus), tools + vision, completely independent of Anthropic
//   tier 3 (gemini-3-flash-preview)      — different provider (Google), vision-capable but text-only on Ollama HTTP (no tool calling)
//   tier 4 (deepseek-v3.2)               — text only, last gasp so the user gets *something* back
//
// Per-instance config can override via "fallbackChain" in config.<instance>.json.
const OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_FALLBACK_CHAIN = [
  { backend: 'claude-cli',     model: 'haiku' },
  { backend: 'ollama',         model: 'gemini-3-flash-preview:cloud' },
  { backend: 'ollama',         model: 'deepseek-v3.2:cloud' },
];
const FALLBACK_CHAIN = config.fallbackChain || DEFAULT_FALLBACK_CHAIN;

// Validate config
if (!BOT_TOKEN) { console.error(`[claude-bridge] FATAL: no botToken in ${CONFIG_PATH}`); process.exit(1); }
if (BACKEND === 'openclaw-agent' && !OPENCLAW_AGENT_ID) {
  console.error(`[claude-bridge] FATAL: backend=openclaw-agent requires "agentId" in ${CONFIG_PATH}`);
  process.exit(1);
}

// ── Logging ────────────────────────────────────────────────────────────────
// NOTE: the launchd plists route stdout/stderr to the SAME file as LOG_FILE,
// so mirroring every line to console.log duplicated every entry. Write to the
// file only; fall back to console.error if the append itself fails so the
// line still lands somewhere (launchd's own fd).
function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] [claude-bridge:${INSTANCE_LABEL}] ${msg}`;
  try { fs.appendFileSync(LOG_FILE, line + '\n'); }
  catch (e) { console.error(line); }
}

// ── State ───────────────────────────────────────────────────────────────────
let state = { sessions: {}, offset: 0 };
if (fs.existsSync(STATE_FILE)) {
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (e) {
    log(`STATE_FILE corrupt at ${STATE_FILE}: ${e.message} — resetting to defaults (sessions lost, offset=0)`);
  }
}

function saveState() {
  // Atomic write: a crash mid-write must not corrupt the state file (a corrupt
  // file silently resets offset + sessions on next start).
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

// ── Telegram API ─────────────────────────────────────────────────────────────
function tgApi(method, params = {}) {
  // getUpdates is a long-poll (30s server-side); other calls are short.
  // Wall-clock cap kills zombie sockets that don't surface ETIMEDOUT.
  const timeoutMs = method === 'getUpdates' ? 60000 : 30000;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON: ' + data)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`tgApi ${method} timed out after ${timeoutMs}ms`));
    });
    req.write(body);
    req.end();
  });
}

// Split text into ≤4096-char chunks without splitting a surrogate pair
// (emoji etc.) at the boundary — Telegram rejects lone surrogates.
function chunkMessage(text) {
  const chunks = [];
  for (let i = 0; i < text.length; ) {
    let end = Math.min(i + MAX_MESSAGE_LENGTH, text.length);
    if (end < text.length) {
      const hi = text.charCodeAt(end - 1);
      const lo = text.charCodeAt(end);
      if (hi >= 0xD800 && hi <= 0xDBFF && lo >= 0xDC00 && lo <= 0xDFFF) end--;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}

// Returns true only if every chunk was confirmed ok:true by Telegram.
// Never rejects — failures are logged and reported via the return value.
async function sendMessage(chatId, text, replyToId) {
  let allOk = true;
  for (const chunk of chunkMessage(text)) {
    // Send as plain text to avoid Markdown parse failures
    const params = { chat_id: chatId, text: chunk, reply_to_message_id: replyToId };
    // Retry transient failures (network/timeout exceptions + 429 rate limits) with
    // backoff. A single dropped sendMessage used to silently lose Maria's reply
    // (2026-06-15: tgApi timed out after 30s, reply never re-sent). Permanent
    // rejections (403, 400, …) are NOT retried — they won't succeed on retry.
    const MAX_ATTEMPTS = 3;
    let res, sent = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        res = await tgApi('sendMessage', params);
      } catch (err) {
        if (attempt < MAX_ATTEMPTS) {
          const backoff = attempt * 3; // 3s, 6s
          log(`sendMessage failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.message} — retrying in ${backoff}s`);
          await new Promise(r => setTimeout(r, backoff * 1000));
          continue;
        }
        log(`sendMessage failed after ${MAX_ATTEMPTS} attempts: ${err.message}`);
        break;
      }
      if (res && res.ok === false && res.error_code === 429 && attempt < MAX_ATTEMPTS) {
        const retryAfter = res.parameters?.retry_after ?? 1;
        log(`sendMessage 429 — retrying after ${retryAfter}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, Math.min(retryAfter, 60) * 1000));
        continue;
      }
      if (res && res.ok === true) sent = true;
      break; // got a definitive (non-retryable) response
    }
    if (!sent) {
      if (res && res.ok !== true) {
        log(`sendMessage rejected by Telegram: error_code=${res?.error_code} description=${res?.description}`);
      }
      allOk = false;
    }
  }
  return allOk;
}

async function sendTyping(chatId) {
  await tgApi('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
}

// ── Photo download ──────────────────────────────────────────────────────────
async function downloadPhoto(fileId) {
  const fileInfo = await tgApi('getFile', { file_id: fileId });
  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    log(`getFile failed: error_code=${fileInfo.error_code} description=${fileInfo.description}`);
    return null;
  }

  const filePath = fileInfo.result.file_path;
  const ext = path.extname(filePath) || '.jpg';
  const localName = `bridge-${Date.now()}${ext}`;
  const localPath = path.join(INBOUND_DIR, localName);

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(localPath);
    const cleanup = () => {
      try { file.close(); } catch {}
      fs.unlink(localPath, () => {});
    };
    const req = https.get(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`, res => {
      if (res.statusCode !== 200) {
        // Without this check a 404/5xx error body was saved as a "successful" .jpg.
        res.resume(); // drain so the socket is released
        cleanup();
        reject(new Error(`photo download HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        log(`Photo saved: ${localPath}`);
        resolve(localPath);
      });
    });
    // A wedged download previously hung forever and the message was silently lost.
    req.setTimeout(30_000, () => {
      req.destroy(new Error('photo download timed out after 30s'));
    });
    req.on('error', err => {
      cleanup();
      reject(err);
    });
  });
}

// ── Claude runner ─────────────────────────────────────────────────────────────
// modelOverride: optional model alias ('haiku', 'sonnet', 'opus', or full model id).
//   If omitted, uses the bridge instance's primary MODEL. Used by the fallback
//   chain to call e.g. `claude --print --model haiku` even when the bridge's
//   primary is sonnet/opus.
function runClaude(userId, prompt, sessionId, photoPath, modelOverride = null) {
  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--dangerously-skip-permissions',
      '--output-format', 'json',
      '--model', modelOverride || MODEL,
    ];
    if (EFFORT) args.push('--effort', EFFORT);
    // Only inject the legacy AGENTS.md system prompt if no isolated cwd is set.
    // When CLAUDE_CWD points to a directory with its own minimal CLAUDE.md, that
    // file IS the system prompt and we should not double-inject AGENTS.md on top.
    if (CLAUDE_CWD === WORKSPACE && SYSTEM_PROMPT_FILE) {
      args.push('--append-system-prompt-file', SYSTEM_PROMPT_FILE);
    }
    if (SETTING_SOURCES) args.push('--setting-sources', SETTING_SOURCES);
    if (sessionId) args.push('--resume', sessionId);

    const env = {
      ...process.env,
      HOME: '/Users/javier',
      USER: 'javier', // Required for Claude CLI auth in cron env
      PATH: '/Users/javier/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    };
    const child = spawn(CLAUDE_BIN, args, {
      cwd: CLAUDE_CWD,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // If photo, include the path so Claude can read it with its Read tool
    const fullPrompt = photoPath
      ? `[Photo attached at: ${photoPath}]\n\n${prompt}`
      : prompt;

    child.stdin.write(fullPrompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);

    // Kill escalation: claude-cli can ignore SIGTERM (e.g. mid-tool-call).
    // Track exit; if still alive 10s after SIGTERM, follow up with SIGKILL.
    let childExited = false;
    child.on('exit', () => { childExited = true; });
    function killChild() {
      try { child.kill(); } catch {}
      const escalate = setTimeout(() => {
        if (!childExited) {
          log(`kill escalation: pid=${child.pid} still alive 10s after SIGTERM — sending SIGKILL`);
          try { child.kill('SIGKILL'); } catch {}
        }
      }, 10_000);
      escalate.unref();
    }

    // ── Adaptive timeout (replaces the fixed 15-min wall on 2026-04-08) ───────
    // Watches the session jsonl that Claude Code writes events to. If the
    // file has been silent for IDLE_TIMEOUT_MS, the spawned claude is genuinely
    // stuck — kill. If activity is recent, extend (claude is making progress,
    // even on long coding tasks). Hard ceiling at ABSOLUTE_MAX_MS as runaway
    // protection. Reference incident: 2026-04-08 opus orphan-cleanup turn was
    // killed mid-dispatcher-iteration despite making continuous progress.
    const ABSOLUTE_MAX_MS = 30 * 60 * 1000; // 30 min — hard ceiling for any single turn
    // IDLE_TIMEOUT_MS: instance-configurable via `adaptiveTimeout.idleMs` in config
    // (or env CLAUDE_BRIDGE_IDLE_MS). Bumped for high-effort models where
    // non-reasoning tool turns can legitimately go silent for 2-3 min.
    const IDLE_TIMEOUT_MS = Number(process.env.CLAUDE_BRIDGE_IDLE_MS)
      || (config.adaptiveTimeout && config.adaptiveTimeout.idleMs)
      || 90 * 1000;
    // Reasoning exception: when the last assistant content block in the session
    // jsonl is `thinking`, the model is mid-extended-reasoning. Extended thinking
    // can run silent for several minutes between jsonl writes — apply a longer
    // ceiling instead of the default 90 sec to avoid false-positive kills.
    // Reference incident: 2026-04-11 05:01 UTC, opus + haiku both killed at 97s
    // and 93s while reasoning about a medication-logging question.
    const REASONING_IDLE_TIMEOUT_MS = 300 * 1000; // 5 min while mid-thinking
    const POLL_INTERVAL_MS = 15_000;          // re-check every 15 sec

    // Encode the cwd to find Claude Code's project dir for this session.
    // Claude Code stores per-cwd transcripts under ~/.claude/projects/<encoded>/<session-id>.jsonl
    // where <encoded> replaces every `/` and `.` in the absolute cwd path with `-`.
    const projectDir = path.join(
      env.HOME || process.env.HOME || '/Users/javier',
      '.claude', 'projects',
      CLAUDE_CWD.replace(/[\/\.]/g, '-')
    );

    // Snapshot existing session jsonls so we can detect the new one this run creates
    let existingJsonls = new Set();
    try {
      if (fs.existsSync(projectDir)) {
        existingJsonls = new Set(fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl')));
      }
    } catch {}

    let sessionFile = null;
    let lastMtimeMs = Date.now();
    const startTime = Date.now();

    // Reads up to the last 16 KB of the session jsonl, walks lines bottom-up,
    // and returns true if the last assistant message's final content block is
    // `thinking` — meaning extended reasoning is in flight and a long quiet
    // period on the file is expected, not a hang.
    function isReasoningInProgress(filePath) {
      try {
        const stat = fs.statSync(filePath);
        const len = stat.size;
        if (!len) return false;
        const readLen = Math.min(len, 16384);
        const buf = Buffer.alloc(readLen);
        const fd = fs.openSync(filePath, 'r');
        try { fs.readSync(fd, buf, 0, readLen, len - readLen); }
        finally { fs.closeSync(fd); }
        const lines = buf.toString('utf8').split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          let j;
          try { j = JSON.parse(lines[i]); } catch { continue; }
          if (j.type !== 'assistant') continue;
          const content = j.message && j.message.content;
          if (!Array.isArray(content) || content.length === 0) return false;
          return content[content.length - 1]?.type === 'thinking';
        }
      } catch {}
      return false;
    }

    function findSessionFile() {
      try {
        if (!fs.existsSync(projectDir)) return null;
        // If we passed --resume, the file path is deterministic
        if (sessionId) {
          const candidate = path.join(projectDir, `${sessionId}.jsonl`);
          if (fs.existsSync(candidate)) return candidate;
        }
        // Otherwise find the most recently modified jsonl that didn't exist before spawn
        const current = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
        const newOnes = current.filter(f => !existingJsonls.has(f));
        if (newOnes.length === 0) return null;
        let newest = null, newestMtime = 0;
        for (const f of newOnes) {
          const fp = path.join(projectDir, f);
          try {
            const m = fs.statSync(fp).mtimeMs;
            if (m > newestMtime) { newestMtime = m; newest = fp; }
          } catch {}
        }
        return newest;
      } catch { return null; }
    }

    const watchInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startTime;

      // Hard ceiling — runaway protection
      if (elapsed > ABSOLUTE_MAX_MS) {
        log(`adaptive timeout: hit absolute max ${Math.round(elapsed/60000)}min — killing pid=${child.pid}`);
        clearInterval(watchInterval);
        killChild();
        reject(new Error(`Claude exceeded absolute max ${ABSOLUTE_MAX_MS/60000} min`));
        return;
      }

      // Locate the session file once it exists
      if (!sessionFile) {
        sessionFile = findSessionFile();
        if (sessionFile) {
          try { lastMtimeMs = fs.statSync(sessionFile).mtimeMs; } catch {}
          log(`adaptive timeout: tracking session file ${sessionFile.split('/').pop()}`);
        }
      }

      // If we have the session file, watch its mtime
      if (sessionFile) {
        try {
          const mtime = fs.statSync(sessionFile).mtimeMs;
          if (mtime > lastMtimeMs) {
            lastMtimeMs = mtime; // claude is making progress
          }
          const idleMs = now - lastMtimeMs;
          const reasoning = isReasoningInProgress(sessionFile);
          const effectiveTimeout = reasoning ? REASONING_IDLE_TIMEOUT_MS : IDLE_TIMEOUT_MS;
          if (idleMs > effectiveTimeout) {
            const tag = reasoning ? ' (reasoning)' : '';
            log(`adaptive timeout: session jsonl idle ${Math.round(idleMs/1000)}s (>${effectiveTimeout/1000}s${tag}) — killing pid=${child.pid}`);
            clearInterval(watchInterval);
            killChild();
            reject(new Error(`Claude appears stuck — session jsonl idle ${Math.round(idleMs/1000)}s${tag}`));
            return;
          }
        } catch {
          // file disappeared mid-run? ignore one tick
        }
      } else if (elapsed > 60000) {
        // 60 sec elapsed and we still can't find the session file → claude probably never started
        log(`adaptive timeout: no session file found after 60s — killing pid=${child.pid}`);
        clearInterval(watchInterval);
        killChild();
        reject(new Error('Claude never created a session file'));
        return;
      }
    }, POLL_INTERVAL_MS);

    child.on('close', code => {
      clearInterval(watchInterval);
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch {}
      if (parsed && typeof parsed === 'object') {
        // claude --print --output-format json reports failures IN-BAND:
        //   { "is_error": true, "subtype": "error_during_execution", "result": "..." }
        // with exit code 0. Previously this resolved as a "successful" reply.
        // Reject so the fallback chain takes over.
        if (parsed.is_error === true || (parsed.subtype && parsed.subtype !== 'success')) {
          const detail = typeof parsed.result === 'string' ? parsed.result.slice(0, 300) : '';
          reject(new Error(`claude-cli reported failure (subtype=${parsed.subtype || 'unknown'}${parsed.is_error ? ', is_error' : ''})${detail ? `: ${detail}` : ''}`));
          return;
        }
        resolve({
          text: parsed.result || parsed.content || stdout.trim(),
          sessionId: parsed.session_id || sessionId,
          source: 'claude',
        });
        return;
      }
      // stdout didn't parse as JSON. Only treat raw stdout as a reply on a
      // clean exit — a non-zero exit with garbage stdout is a failure.
      if (code === 0 && stdout.trim()) {
        resolve({ text: stdout.trim(), sessionId, source: 'claude' });
      } else {
        reject(new Error(stderr.trim() || `Claude exited with code ${code}`));
      }
    });

    child.on('error', err => {
      clearInterval(watchInterval);
      reject(err);
    });
  });
}

// ── OpenClaw agent runner (used by codex backend) ──────────────────────────
// Spawns `openclaw agent --agent <id> -m <prompt> --json --thinking off`.
// The agent's own configured model + auth profile + workspace AGENTS.md
// are used — no model override at the call site (openclaw agent has no
// --model flag). To switch models, edit the agent's config via openclaw CLI.
// Sessions are persisted via session-id in state.sessions[userId] just like
// the claude-cli path; if openclaw agent's JSON output includes session_id /
// sessionId, we capture it for /resume.
// agentIdOverride: optional openclaw agent id. If omitted, uses the bridge
// instance's configured OPENCLAW_AGENT_ID. Used by the fallback chain so
// non-codex bridges can fallback into codex-bridge.
function runOpenclawAgent(userId, prompt, sessionId, photoPath, agentIdOverride = null) {
  return new Promise((resolve, reject) => {
    const agentId = agentIdOverride || OPENCLAW_AGENT_ID;
    if (!agentId) return reject(new Error('runOpenclawAgent called with no agentId'));
    const args = ['agent', '--agent', agentId, '--json', '-m', prompt];
    if (sessionId) { args.push('--session-id', sessionId); }
    // Photos: openclaw agent doesn't have a --photo flag; we inject the path
    // into the message body so the agent's tools can read it if vision-capable.
    if (photoPath) {
      args[args.indexOf(prompt)] = `[Photo attached at: ${photoPath}]\n\n${prompt}`;
    }

    const env = {
      ...process.env,
      HOME: '/Users/javier',
      USER: 'javier', // Required for Claude CLI auth in cron env
      PATH: '/Users/javier/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    };
    const child = spawn(OPENCLAW_BIN, args, { cwd: WORKSPACE, env, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);

    const killTimer = setTimeout(() => { child.kill(); reject(new Error('openclaw agent timed out after 8 minutes')); }, 480_000);

    child.on('close', code => {
      clearTimeout(killTimer);
      if (code !== 0 && !stdout.trim()) {
        return reject(new Error(stderr.trim() || `openclaw agent exited with code ${code}`));
      }
      // openclaw agent --json shape (verified 2026-04-06):
      //   { runId, status, summary, result: { payloads: [{ text, mediaUrl }], meta: { agentMeta: { sessionId } } } }
      // Concatenate all text payloads (a single turn can return >1 payload).
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.status && parsed.status !== 'ok') {
          return reject(new Error(`openclaw agent status=${parsed.status}: ${JSON.stringify(parsed.summary || parsed).slice(0, 300)}`));
        }
        const payloads = parsed.result?.payloads || [];
        const text = payloads.map(p => p.text).filter(Boolean).join('\n\n').trim()
          || parsed.result?.text
          || stdout.trim();
        const sid = parsed.result?.meta?.agentMeta?.sessionId || sessionId || null;
        resolve({ text, sessionId: sid, source: `openclaw/${agentId}` });
      } catch {
        // Non-JSON output — return raw stdout
        resolve({ text: stdout.trim() || stderr.trim(), sessionId, source: `openclaw/${agentId}` });
      }
    });
    child.on('error', reject);
  });
}

// ── Ollama fallback ─────────────────────────────────────────────────────────
// photoPath: optional local image path. If provided, the file is base64-encoded
// and added to the user message under `images: [...]` per Ollama's vision API
// convention. The model still has no tool surface — this is best-effort vision
// only, not a working agent loop.
function runOllama(prompt, model, photoPath = null) {
  return new Promise((resolve, reject) => {
    const userMsg = { role: 'user', content: prompt };
    if (photoPath) {
      try {
        const imgB64 = fs.readFileSync(photoPath).toString('base64');
        userMsg.images = [imgB64];
      } catch (err) {
        // If image read fails, fall through to text-only — better than dying
      }
    }
    const body = JSON.stringify({
      model,
      messages: [userMsg],
      stream: false,
    });

    const url = new URL(`${OLLAMA_URL}/api/chat`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const content = parsed.message?.content;
          if (content) resolve({ text: content, sessionId: null, source: `ollama/${model}` });
          else reject(new Error(`Empty Ollama response (${model})`));
        } catch { reject(new Error('Invalid Ollama JSON')); }
      });
    });

    req.on('error', reject);
    req.setTimeout(300_000, () => { req.destroy(); reject(new Error('Ollama timed out')); });
    req.write(body);
    req.end();
  });
}

// ── Codex CLI fallback ──────────────────────────────────────────────────────
// Runs `codex exec` (OpenAI Codex CLI, authenticated via ChatGPT-subscription
// OAuth — run `codex login` once interactively to set up). Read-only sandbox:
// the model can read files (vision via -i) but CANNOT write health_log.md or
// run mutating commands — same best-effort semantics as the ollama tier.
// Added 2026-07-03 to replace the dead Ollama cloud tiers (subscription lapsed).
const CODEX_BIN = '/opt/homebrew/bin/codex';
function runCodex(prompt, model = null, photoPath = null) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(WORKSPACE, 'tmp', `codex-last-${process.pid}-${Date.now()}.txt`);
    const args = ['exec', '--ephemeral', '--skip-git-repo-check', '--color', 'never',
                  '-s', 'read-only', '-C', CLAUDE_CWD, '-o', outFile];
    if (model) args.push('-m', model);
    if (photoPath) args.push('-i', photoPath);
    args.push('-'); // read the prompt from stdin (avoids ARG_MAX/quoting issues)
    const child = spawn(CODEX_BIN, args, {
      cwd: CLAUDE_CWD,
      env: {
        ...process.env,
        HOME: '/Users/javier',
        USER: 'javier',
        PATH: '/Users/javier/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
      },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 300_000);
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      let text = '';
      try { text = fs.readFileSync(outFile, 'utf8').trim(); fs.unlinkSync(outFile); } catch {}
      if (code === 0 && text) {
        resolve({ text, sessionId: null, source: `codex/${model || 'default'}` });
      } else {
        reject(new Error(`codex exec failed (exit ${code}): ${(stderr.trim() || 'no stderr').slice(0, 200)}`));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ── Durable inbox journal ────────────────────────────────────────────────────
// The poll loop advances state.offset BEFORE processing completes, and the
// poll watchdog process.exit(2) drops anything queued/in-flight. The journal
// is the recovery net: every fetched update is appended BEFORE the offset
// advances; a {done: update_id} marker is appended after handleMessage
// settles. On startup, updates from the last 24h without a done marker are
// re-enqueued through the normal queue path, then the journal is compacted.
const INBOX_FILE = path.join(WORKSPACE, `data/bridge_inbox_${INSTANCE_LABEL}.jsonl`);
const INBOX_RETENTION_MS = 24 * 60 * 60 * 1000;

function journalAppend(obj) {
  try { fs.appendFileSync(INBOX_FILE, JSON.stringify(obj) + '\n'); }
  catch (e) { log(`inbox journal append failed: ${e.message}`); }
}

function journalMarkDone(updateId) {
  if (updateId == null) return;
  journalAppend({ done: updateId, ts: Date.now() });
}

function recoverInbox() {
  if (!fs.existsSync(INBOX_FILE)) return;
  let lines;
  try { lines = fs.readFileSync(INBOX_FILE, 'utf8').split('\n').filter(Boolean); }
  catch (e) { log(`inbox recovery: read failed: ${e.message}`); return; }

  const cutoff = Date.now() - INBOX_RETENTION_MS;
  const pending = new Map(); // update_id -> journal record
  for (const line of lines) {
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.done != null) pending.delete(j.done);
    else if (j.update_id != null && j.msg) pending.set(j.update_id, j);
  }
  const toReplay = [...pending.values()]
    .filter(r => (r.ts || 0) >= cutoff)
    .sort((a, b) => a.update_id - b.update_id);

  // Compact: rewrite keeping only the last 24h of lines (atomic).
  try {
    const kept = lines.filter(line => {
      try { return (JSON.parse(line).ts || 0) >= cutoff; } catch { return false; }
    });
    const tmp = INBOX_FILE + '.tmp';
    fs.writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '');
    fs.renameSync(tmp, INBOX_FILE);
  } catch (e) {
    log(`inbox recovery: compaction failed: ${e.message}`);
  }

  if (toReplay.length === 0) {
    log('inbox recovery: no unfinished updates from the last 24h');
    return;
  }
  log(`inbox recovery: re-enqueueing ${toReplay.length} unfinished update(s) from the last 24h`);
  for (const r of toReplay) {
    const m = r.msg;
    m.__update_id = r.update_id;
    handleMessage(m).catch(err => log(`inbox replay error: ${err.message}`));
  }
}

// ── Message handler ──────────────────────────────────────────────────────────
const inFlight = new Set();
const userQueues = new Map();

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text?.trim() || msg.caption?.trim() || '';
  const msgId = msg.message_id;

  if (!userId) { journalMarkDone(msg.__update_id); return; }
  if (!ALLOWED_USERS.includes(userId)) {
    await sendMessage(chatId, 'Not authorized.');
    journalMarkDone(msg.__update_id);
    return;
  }

  // Image sent as a *file* (document) — the photo pipeline only handles
  // msg.photo. Hint instead of silently ignoring. Documents are not processed.
  if (msg.document && /^image\//i.test(msg.document.mime_type || '')) {
    await sendMessage(chatId, 'I can’t process images sent as files — please send it as a photo, not a file.', msgId);
    journalMarkDone(msg.__update_id);
    return;
  }

  const hasPhoto = msg.photo && msg.photo.length > 0;
  if (!text && !hasPhoto) { journalMarkDone(msg.__update_id); return; }

  if (inFlight.has(userId)) {
    if (!userQueues.has(userId)) userQueues.set(userId, []);
    userQueues.get(userId).push(msg);
    log(`queued message ${msgId} for user ${userId} (depth=${userQueues.get(userId).length})`);
    return; // done marker is written when the queued message is drained
  }

  // Drain loop: hold the inFlight flag until this user's queue is empty.
  // (Previously inFlight was cleared in a finally BEFORE the setImmediate
  // drain ran, letting a freshly-polled message jump ahead of queued ones.)
  inFlight.add(userId);
  try {
    let current = msg;
    while (current) {
      try {
        await processMessage(current);
      } catch (err) {
        log(`processMessage error: ${err.message}`);
      }
      journalMarkDone(current.__update_id);
      const q = userQueues.get(userId);
      if (q && q.length > 0) {
        current = q.shift();
        if (q.length === 0) userQueues.delete(userId);
      } else {
        userQueues.delete(userId);
        current = null;
      }
    }
  } finally {
    inFlight.delete(userId);
  }
}

async function processMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text?.trim() || msg.caption?.trim() || '';
  const msgId = msg.message_id;
  const hasPhoto = msg.photo && msg.photo.length > 0;

  // ── Built-in commands ────────────────────────────────────────────────────
  if (text === '/reset') {
    delete state.sessions[userId];
    saveState();
    await sendMessage(chatId, 'Session reset. Next message starts fresh.', msgId);
    return;
  }
  if (text === '/status') {
    const sid = state.sessions[userId];
    await sendMessage(chatId, sid
      ? `Active session: ${sid.slice(0, 8)}...\nModel: ${MODEL}\nFallbacks: ${FALLBACK_CHAIN.map(t => `${t.backend}/${t.model || t.agentId}`).join(' > ')}\nWorkspace: ${WORKSPACE}`
      : `No active session. Model: ${MODEL}. Send any message to start one.`,
      msgId);
    return;
  }
  if (text === '/help') {
    await sendMessage(chatId, [
      'Claude Code Bridge',
      '',
      'Send any message (text or photo) to talk to Claude Code.',
      '',
      'Commands:',
      '  /reset  — start a fresh session',
      '  /status — show current session info',
      '  /help   — this message',
      '',
      `Model: ${MODEL} | Fallbacks: ${FALLBACK_CHAIN.map(t => `${t.backend}/${t.model || t.agentId}`).join(' > ')}`,
      `Workspace: ${WORKSPACE}`,
      'CLAUDE.md + AGENTS.md load automatically.',
    ].join('\n'), msgId);
    return;
  }

  // ── Download photo if present ───────────────────────────────────────────
  let photoPath = null;
  if (hasPhoto) {
    try {
      // Telegram sends multiple sizes — take the largest (last in array)
      const largestPhoto = msg.photo[msg.photo.length - 1];
      photoPath = await downloadPhoto(largestPhoto.file_id);
    } catch (err) {
      log(`Photo download failed: ${err.message}`);
    }
    if (!photoPath) {
      // Previously the agent was still invoked with a photo prompt but NO
      // photo — it would hallucinate or log a bogus entry. Tell the user
      // instead and skip the agent entirely for this message.
      log(`Photo unavailable for message ${msgId} — asked user to resend, agent not invoked`);
      await sendMessage(chatId, '⚠️ Photo didn’t come through — please resend', msgId);
      return;
    }
  }

  // ── Upload photo to freeimage ahead of agent (opt-in via config) ────────
  // When enabled, the bridge handles the freeimage.host upload itself so the
  // agent receives a URL instead of having to run curl from its bash step.
  // On failure, the agent is told to use the placeholder fallback — the
  // rescue_pending_photos cron picks those up.
  let photoUploadUrl = null;
  let photoUploadFailed = false;
  if (photoPath && UPLOAD_PHOTO_BEFORE_AGENT) {
    photoUploadUrl = await uploadPhotoToFreeimage(photoPath);
    if (photoUploadUrl) log(`photo uploaded`);
    else { photoUploadFailed = true; log(`photo upload failed`); }
  }

  // ── Forward to Claude (with Ollama fallback) ────────────────────────────
  // (inFlight is managed by handleMessage's drain loop, not here.)
  let typingInterval;
  try {
    typingInterval = setInterval(() => sendTyping(chatId), 4000);
    sendTyping(chatId);

    const sessionId = state.sessions[userId] || null;
    let prompt = text || (photoPath ? DEFAULT_PHOTO_PROMPT : '');

    // Prepend upload result so the agent doesn't re-upload. CLAUDE.md defines behavior.
    if (photoUploadUrl) {
      prompt = `[photo_url: ${photoUploadUrl}]\n\n${prompt}`;
    } else if (photoUploadFailed) {
      prompt = `[photo_upload_failed]\n\n${prompt}`;
    }

    // Prepend submission time. msg.date is unix seconds. Format mirrors the
    // bash ===NOW=== output the agent already knows: "YYYY-MM-DD HH:MM ±HH:MM".
    // CLAUDE.md tells the agent to use this for the entry timestamp instead of
    // bash `date` whenever the tag is present (delayed/queued messages).
    if (msg.date) {
      const d = new Date(msg.date * 1000);
      const pad = n => String(n).padStart(2, '0');
      const offMin = -d.getTimezoneOffset();
      const offSign = offMin >= 0 ? '+' : '-';
      const submittedAt = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${offSign}${pad(Math.floor(Math.abs(offMin)/60))}:${pad(Math.abs(offMin)%60)}`;
      prompt = `[submitted_at: ${submittedAt}]\n\n${prompt}`;
    }

    // Warn user if taking too long
    const warnTimeout = setTimeout(() => sendMessage(chatId,
      'Still working... (4 min elapsed, will wait up to 8 min total)'
    ).catch(() => {}), 240_000);

    let result;
    let lastErr;
    // Primary: pick runner based on backend
    try {
      if (BACKEND === 'openclaw-agent') {
        result = await runOpenclawAgent(userId, prompt, sessionId, photoPath);
      } else {
        result = await runClaude(userId, prompt, sessionId, photoPath);
      }
    } catch (primaryErr) {
      log(`Primary backend (${BACKEND}) failed: ${primaryErr.message}`);
      lastErr = primaryErr;
    }
    // Multi-backend fallback chain: try each tier in order. Each tier is a
    // {backend, model?, agentId?} object — see DEFAULT_FALLBACK_CHAIN comment
    // for the supported backends.
    if (!result) {
      for (const tier of FALLBACK_CHAIN) {
        const tierLabel = `${tier.backend}/${tier.model || tier.agentId || '?'}`;
        try {
          log(`Trying fallback: ${tierLabel}`);
          if (tier.backend === 'claude-cli') {
            // Fresh session (no --resume) — primary's session may be in a bad state.
            // Pass photoPath unchanged: claude-cli backend has full vision via Read tool.
            result = await runClaude(userId, prompt, null, photoPath, tier.model);
          } else if (tier.backend === 'openclaw-agent') {
            // Fresh openclaw session for the same reason.
            result = await runOpenclawAgent(userId, prompt, null, photoPath, tier.agentId);
          } else if (tier.backend === 'codex-cli') {
            // Codex runs in a read-only sandbox: it can read the photo and any
            // workspace files but cannot write entries or run mutating commands.
            const fallbackPrompt = photoPath
              ? `${prompt}\n\n(Note: a photo was attached at ${photoPath}. This fallback runs in a READ-ONLY sandbox — it CANNOT write files or complete the full logging workflow. Best-effort analysis only; tell the user the entry was NOT logged.)`
              : `${prompt}\n\n(Note: this fallback runs in a READ-ONLY sandbox — it CANNOT write files or complete the full logging workflow. Best-effort analysis only; tell the user the entry was NOT logged.)`;
            result = await runCodex(fallbackPrompt, tier.model, photoPath);
          } else if (tier.backend === 'ollama') {
            // Ollama is single-shot (no tools). Photo is base64-encoded into the
            // request if the model supports vision; otherwise still passes the path
            // as text (best-effort, may produce a description but cannot complete
            // tool-requiring workflows like the food log).
            const fallbackPrompt = photoPath
              ? `${prompt}\n\n(Note: a photo was attached at ${photoPath}. This fallback model is single-shot — it CANNOT execute tools, fetch data, or write files. Best-effort description only.)`
              : prompt;
            result = await runOllama(fallbackPrompt, tier.model, photoPath);
          } else {
            log(`Unknown fallback backend: ${tier.backend} — skipping`);
            continue;
          }
          if (result) break;
        } catch (err) {
          log(`Fallback ${tierLabel} failed: ${err.message}`);
          lastErr = err;
        }
      }
    }
    clearTimeout(warnTimeout);
    if (!result) {
      delete state.sessions[userId];
      saveState();
      clearInterval(typingInterval);
      await sendMessage(chatId,
        `All models failed. Last error: ${lastErr?.message}\n\nSession reset.`, msgId);
      return;
    }

    clearInterval(typingInterval);

    // Persist session (Claude only — Ollama is stateless)
    if (result.sessionId) {
      state.sessions[userId] = result.sessionId;
      saveState();
    }

    const sourceTag = result.source !== 'claude' ? `\n\n[via ${result.source} fallback — no session context]` : '';
    const delivered = await sendMessage(chatId, result.text + sourceTag, msgId);
    if (delivered) {
      log(`Replied to ${userId} via ${result.source} (${result.text.length} chars)`);
    } else {
      log(`Reply delivery FAILED to ${userId} via ${result.source} (${result.text.length} chars) — see sendMessage errors above`);
    }

    // Fire post-reply detached command (e.g. radial_dispatcher.js to sync health_log).
    // Uses Node's canonical fully-detached spawn pattern so the dispatcher runs
    // independently and the bridge does not wait for it.
    if (POST_REPLY_DETACHED && result.source === 'claude') {
      try {
        const detachedCwd = POST_REPLY_DETACHED.cwd || WORKSPACE;
        const detached = spawn(POST_REPLY_DETACHED.cmd, POST_REPLY_DETACHED.args || [], {
          cwd: detachedCwd,
          detached: true,
          stdio: 'ignore',
          env: process.env,
        });
        detached.unref();
        log(`Post-reply detached: ${POST_REPLY_DETACHED.cmd} ${(POST_REPLY_DETACHED.args || []).join(' ')} (pid ${detached.pid})`);
      } catch (err) {
        log(`Post-reply detached failed: ${err.message}`);
      }
    }
  } catch (err) {
    clearInterval(typingInterval);
    log(`handleMessage error: ${err.message}`);
    delete state.sessions[userId];
    saveState();
    await sendMessage(chatId, `Error: ${err.message}\n\nSession reset — next message starts fresh.`, msgId);
  }
}

// ── Polling loop ─────────────────────────────────────────────────────────────
let lastSuccessfulPollMs = Date.now();
const POLL_WATCHDOG_MS = 5 * 60 * 1000;

async function poll() {
  try {
    const res = await tgApi('getUpdates', {
      offset: state.offset,
      timeout: 30,
      allowed_updates: ['message'],
    });
    if (res.ok) {
      lastSuccessfulPollMs = Date.now();
      if (res.result?.length) {
        for (const update of res.result) {
          if (update.message) {
            // Journal BEFORE advancing the offset — this is the durable record
            // that survives a crash / watchdog process.exit(2).
            update.message.__update_id = update.update_id;
            journalAppend({
              update_id: update.update_id,
              ts: Date.now(),
              chat_id: update.message.chat?.id,
              from_id: update.message.from?.id,
              text: update.message.text || update.message.caption || null,
              photo_file_id: update.message.photo?.length
                ? update.message.photo[update.message.photo.length - 1].file_id
                : null,
              msg: update.message,
            });
          }
          state.offset = update.update_id + 1;
          if (update.message) handleMessage(update.message).catch(err => log(`handler error: ${err.message}`));
        }
        saveState();
      }
    } else {
      log(`getUpdates failed: error_code=${res.error_code} description=${res.description}`);
    }
  } catch (err) {
    log(`poll error: ${err.message}`);
  }
  setTimeout(poll, POLL_INTERVAL_MS);
}

setInterval(() => {
  const sinceMs = Date.now() - lastSuccessfulPollMs;
  if (sinceMs > POLL_WATCHDOG_MS) {
    log(`watchdog: no successful poll in ${Math.round(sinceMs/1000)}s — exiting so launchd restarts`);
    process.exit(2);
  }
}, 30000).unref();

// ── Start ─────────────────────────────────────────────────────────────────────
const fallbackChainLabel = FALLBACK_CHAIN.map(t => `${t.backend}/${t.model || t.agentId}`).join(' > ');
const idleMsCfg = Number(process.env.CLAUDE_BRIDGE_IDLE_MS) || (config.adaptiveTimeout && config.adaptiveTimeout.idleMs) || 90000;
log(`Starting — instance=${INSTANCE_LABEL}, backend=${BACKEND}, model=${MODEL}${EFFORT ? `, effort=${EFFORT}` : ''}${OPENCLAW_AGENT_ID ? `, agent=${OPENCLAW_AGENT_ID}` : ''}, idle=${idleMsCfg/1000}s, fallbacks=[${fallbackChainLabel}], cwd=${CLAUDE_CWD}, config=${CONFIG_PATH}, state=${STATE_FILE}`);
tgApi('getMe').then(r => {
  if (!r.ok) { log(`Bad token or Telegram unreachable: ${JSON.stringify(r)}`); process.exit(1); }
  log(`Bot: @${r.result.username}`);
  recoverInbox(); // re-enqueue journaled updates that never finished (crash recovery)
  poll();
}).catch(err => { log(`Startup failed: ${err.message}`); process.exit(1); });
