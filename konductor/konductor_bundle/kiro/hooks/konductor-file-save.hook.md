---
name: Konductor File Save
description: Registers file changes with Konductor on save and logs collision state to terminal and log file.
trigger:
  type: onFileSave
  filePattern: "**/*.{ts,tsx,js,jsx,py,java,go,rs,rb,c,cpp,h,hpp,cs,swift,kt,yaml,yml,json,md,html,css,scss,sql,sh}"
action:
  type: runCommand
  command: |
    node -e "
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');

    const filePath = '{{filePath}}';

    // Load env
    const envPath = path.resolve('.konductor-watcher.env');
    const env = {};
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i === -1) continue;
        env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^[\"']|[\"']$/g, '');
      }
    }

    const url = env.KONDUCTOR_URL || process.env.KONDUCTOR_URL || 'http://localhost:3010';
    const apiKey = env.KONDUCTOR_API_KEY || process.env.KONDUCTOR_API_KEY || '';
    const logFile = env.KONDUCTOR_LOG_FILE || process.env.KONDUCTOR_LOG_FILE || '';
    const logToTerminal = (env.KONDUCTOR_LOG_TO_TERMINAL || process.env.KONDUCTOR_LOG_TO_TERMINAL || 'true').toLowerCase() === 'true';

    function git(cmd) { try { return execSync(cmd, {encoding:'utf-8',stdio:['pipe','pipe','pipe']}).trim(); } catch { return ''; } }

    const userId = env.KONDUCTOR_USER || process.env.KONDUCTOR_USER || git('gh api user --jq .login') || git('git config user.name') || 'unknown';
    const repoUrl = git('git remote get-url origin');
    const repoMatch = repoUrl.match(/[:\\/]([^\\/]+\\/[^\\/]+?)(?:\\.git)?$/);
    const repo = env.KONDUCTOR_REPO || process.env.KONDUCTOR_REPO || (repoMatch ? repoMatch[1] : 'unknown/unknown');
    const branch = env.KONDUCTOR_BRANCH || process.env.KONDUCTOR_BRANCH || git('git branch --show-current') || 'unknown';

    const relFile = path.relative(process.cwd(), filePath).replace(/\\\\/g, '/');

    function localTs() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
    }

    function log(msg) {
      const clean = msg.replace(/\\x1b\\[[0-9;]*m/g, '');
      if (logToTerminal) process.stderr.write(msg + '\\n');
      if (logFile) {
        try { fs.appendFileSync(path.resolve(logFile), localTs() + ' ' + clean + '\\n'); } catch {}
      }
    }

    async function run() {
      const headers = {'Content-Type':'application/json'};
      if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

      try {
        const regRes = await fetch(url + '/api/register', {
          method:'POST', headers, body: JSON.stringify({userId, repo, branch, files:[relFile]})
        });
        const regData = await regRes.json();
        if (regData.error) { log('⚠️  Konductor: ' + regData.error); return; }

        const statusRes = await fetch(url + '/api/status', {
          method:'POST', headers, body: JSON.stringify({userId, repo})
        });
        const statusData = await statusRes.json();
        const state = statusData.collisionState || regData.collisionState || 'unknown';
        const others = (statusData.overlappingSessions || []).filter(s => s.userId !== userId);
        const shared = statusData.sharedFiles || [];
        const repoShort = repo.split('/').pop();
        const dashUrl = statusData.repoPageUrl || regData.repoPageUrl || '';
        const dashLink = dashUrl ? ' 📊 ' + dashUrl : '';

        if (state === 'solo') {
          log('🟢 [Konductor] SOLO on ' + repoShort + '/' + branch + ' — saved: ./' + relFile);
        } else if (state === 'neighbors') {
          log('🟢 [Konductor] NEIGHBORS on ' + repoShort + '/' + branch + ' — ' + others.map(s=>s.userId).join(', ') + ' also active. Saved: ./' + relFile);
        } else if (state === 'crossroads') {
          log('🟡 [Konductor] CROSSROADS on ' + repoShort + '/' + branch + ' — ' + others.map(s=>s.userId).join(', ') + ' in same dirs. Saved: ./' + relFile + dashLink);
        } else if (state === 'proximity') {
          log('🟢 [Konductor] PROXIMITY on ' + repoShort + '/' + branch + ' — same files as ' + others.map(s=>s.userId).join(', ') + ', different sections. Saved: ./' + relFile + dashLink);
        } else if (state === 'collision_course') {
          log('🟠 [Konductor] COLLISION COURSE on ' + repoShort + '/' + branch + ' — ' + others.map(s=>s.userId).join(', ') + ' on same files: ' + shared.join(', ') + '. Saved: ./' + relFile + dashLink);
        } else if (state === 'merge_hell') {
          log('🔴 [Konductor] MERGE HELL on ' + repoShort + '/' + branch + ' — divergent changes with ' + others.map(s=>s.userId).join(', ') + ' on: ' + shared.join(', ') + '. Saved: ./' + relFile + dashLink);
        } else {
          log('🟢 [Konductor] ' + state + ' — saved: ./' + relFile);
        }
      } catch (e) {
        log('⚠️  Konductor: Server not reachable. ./' + relFile + ' is untracked.');
      }
    }
    run();
    "
---
