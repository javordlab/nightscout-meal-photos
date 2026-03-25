const fs = require('fs');
const path = require('path');

const AGENTS_DIR = '/Users/javier/.openclaw/agents';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function getTodayStart() {
  const d = new Date();
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  return new Date(`${dateStr}T00:00:00`).getTime();
}

function checkUsage() {
  const todayStart = getTodayStart();
  let geminiToday = 0;
  let kimiToday = 0;

  const agents = fs.readdirSync(AGENTS_DIR);
  for (const agent of agents) {
    const sessionPath = path.join(AGENTS_DIR, agent, 'sessions', 'sessions.json');
    if (!fs.existsSync(sessionPath)) continue;

    try {
      const sessions = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      for (const key in sessions) {
        const s = sessions[key];
        if (s.updatedAt >= todayStart) {
          const tokens = (s.totalTokens || 0) + (s.inputTokens || 0) + (s.outputTokens || 0);
          if (s.modelProvider === 'google-antigravity' || s.modelProvider === 'google-gemini-cli' || (s.model && s.model.includes('gemini'))) {
            geminiToday += tokens;
          } else if (s.modelProvider === 'ollama' || (s.model && s.model.includes('kimi'))) {
            kimiToday += tokens;
          }
        }
      }
    } catch (e) {}
  }

  console.log(`\nUsage for today (${new Date().toLocaleDateString('en-US', { timeZone: TZ })}):`);
  console.log(`-------------------------------------------`);
  console.log(`Gemini (Flash/Pro) : ${geminiToday.toLocaleString()} tokens used (Cap: 250,000)`);
  console.log(`Kimi (Ollama)      : ${kimiToday.toLocaleString()} tokens used (Cap: Unlimited/Local)`);
  console.log(`-------------------------------------------`);
  if (geminiToday > 250000) {
    console.log(`!! ALERT: You are OVER your 250K Gemini bucket.`);
  } else {
    console.log(`Remaining Gemini: ${(250000 - geminiToday).toLocaleString()} tokens.`);
  }
}

checkUsage();
