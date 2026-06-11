#!/usr/bin/env node
/**
 * deploy_gh_pages.js
 * Syncs nightscout-meal-photos/ subfolder to the gh-pages branch.
 * Should be called after any update to notion_meals.json, backups.json, or chart PNGs.
 *
 * Concurrent callers are serialized via an O_EXLOCK file lock; back-to-back
 * pushes are separated by at least MIN_GAP_MS to avoid GitHub Pages "deployment
 * in progress" 400s when one workflow is still rolling out.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const SITE_DIR = path.join(WORKSPACE, 'nightscout-meal-photos');
const WORKTREE = '/tmp/gh-pages-deploy';
const LOCK_FILE = '/tmp/deploy_gh_pages.lock';
const LAST_PUSH_FILE = '/tmp/deploy_gh_pages.last_push';
const MIN_GAP_MS = 60_000;

let lockFd = null;
function acquireLock() {
  // O_EXLOCK is BSD/darwin: open() blocks until exclusive lock is acquired.
  lockFd = fs.openSync(
    LOCK_FILE,
    fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXLOCK,
    0o644
  );
}
function releaseLock() {
  if (lockFd !== null) {
    try { fs.closeSync(lockFd); } catch {}
    lockFd = null;
  }
}

async function waitMinGap() {
  if (!fs.existsSync(LAST_PUSH_FILE)) return;
  const last = parseInt(fs.readFileSync(LAST_PUSH_FILE, 'utf8'), 10);
  if (!Number.isFinite(last)) return;
  const elapsed = Date.now() - last;
  if (elapsed >= MIN_GAP_MS) return;
  const wait = MIN_GAP_MS - elapsed;
  console.log(`gh-pages: waiting ${Math.round(wait / 1000)}s for min-gap before pushing.`);
  await new Promise(r => setTimeout(r, wait));
}

function recordPush() {
  fs.writeFileSync(LAST_PUSH_FILE, String(Date.now()));
}

function run(cmd, opts = {}) {
  // Timeout: this script holds an exclusive lock — a hung git command (e.g. a
  // wedged push) would otherwise block every future deploy forever. Network
  // operations (push/fetch) get a longer budget than local ones.
  const isNetwork = /\bgit (push|fetch|pull)\b/.test(cmd);
  const timeout = isNetwork ? 300000 : 120000;
  const result = execSync(cmd, { stdio: opts.silent ? 'pipe' : 'inherit', timeout, ...opts });
  return result ? result.toString().trim() : '';
}

// A worktree is usable only when both the admin dir lists it AND the working
// directory still contains the .git pointer. macOS /tmp cleaning can delete
// the pointer while leaving the rest of the files — causing git to think the
// worktree exists when it no longer does.
function worktreeIsHealthy() {
  const worktreeList = run('git worktree list', { cwd: WORKSPACE, silent: true });
  if (!worktreeList.includes(WORKTREE)) return false;
  return fs.existsSync(path.join(WORKTREE, '.git'));
}

async function main() {
  acquireLock();
  try {
    if (!worktreeIsHealthy()) {
      // Prune stale admin entries and remove any orphaned directory, then recreate.
      try { run(`git worktree remove --force ${WORKTREE}`, { cwd: WORKSPACE, silent: true }); } catch {}
      run('git worktree prune', { cwd: WORKSPACE, silent: true });
      if (fs.existsSync(WORKTREE)) {
        run(`rm -rf ${WORKTREE}`);
      }
      run(`git worktree add ${WORKTREE} gh-pages`, { cwd: WORKSPACE, silent: true });
    }

    // Sync site files to worktree (rsync: delete removed files, skip .git)
    run(`rsync -av --delete --exclude='.git' ${SITE_DIR}/ ${WORKTREE}/`);

    // Stage and commit if anything changed
    const status = run('git status --porcelain', { cwd: WORKTREE, silent: true }) || '';
    if (!status) {
      console.log('gh-pages: nothing to deploy.');
      return;
    }

    await waitMinGap();

    run('git add -A', { cwd: WORKTREE });
    const ts = new Date().toISOString();
    run(`git commit --no-verify -m "deploy: auto-sync site files ${ts}"`, { cwd: WORKTREE });
    run('git push origin gh-pages', { cwd: WORKTREE });
    recordPush();
    console.log(`gh-pages: deployed at ${ts}`);
  } finally {
    releaseLock();
  }
}

main().catch(e => {
  releaseLock();
  console.error('gh-pages deploy failed:', e.message);
  process.exit(1);
});
