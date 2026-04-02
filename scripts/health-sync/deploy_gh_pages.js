#!/usr/bin/env node
/**
 * deploy_gh_pages.js
 * Syncs nightscout-meal-photos/ subfolder to the gh-pages branch.
 * Should be called after any update to notion_meals.json, backups.json, or chart PNGs.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const SITE_DIR = path.join(WORKSPACE, 'nightscout-meal-photos');
const WORKTREE = '/tmp/gh-pages-deploy';

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: opts.silent ? 'pipe' : 'inherit', ...opts }).toString().trim();
}

async function main() {
  // Ensure worktree exists and is on gh-pages branch
  const worktreeList = run('git worktree list', { cwd: WORKSPACE, silent: true });
  if (!worktreeList.includes(WORKTREE)) {
    if (fs.existsSync(WORKTREE)) {
      run(`rm -rf ${WORKTREE}`);
    }
    run(`git worktree add ${WORKTREE} gh-pages`, { cwd: WORKSPACE, silent: true });
  }

  // Sync site files to worktree (rsync: delete removed files, skip .git)
  run(`rsync -av --delete --exclude='.git' ${SITE_DIR}/ ${WORKTREE}/`);

  // Stage and commit if anything changed
  const status = run('git status --porcelain', { cwd: WORKTREE, silent: true });
  if (!status) {
    console.log('gh-pages: nothing to deploy.');
    return;
  }

  run('git add -A', { cwd: WORKTREE });
  const ts = new Date().toISOString();
  run(`git commit --no-verify -m "deploy: auto-sync site files ${ts}"`, { cwd: WORKTREE });
  run('git push origin gh-pages', { cwd: WORKTREE });
  console.log(`gh-pages: deployed at ${ts}`);
}

main().catch(e => { console.error('gh-pages deploy failed:', e.message); process.exit(1); });
