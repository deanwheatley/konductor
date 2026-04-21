#!/usr/bin/env node
/**
 * Generates bundle-manifest.json for the konductor-setup package.
 *
 * Sources:
 *   - version: from package.json
 *   - author: from `git config user.name` (falls back to "unknown")
 *   - createdAt: current ISO 8601 timestamp
 *   - summary: first entry from CHANGELOG.md (falls back to "")
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// 1. Read version from package.json
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version;

// 2. Get author from git config
let author = 'unknown';
try {
  author = execSync('git config user.name', { encoding: 'utf8' }).trim();
} catch {
  // git not available or user.name not set
}

// 3. Current timestamp
const createdAt = new Date().toISOString();

// 4. Extract first changelog entry summary
let summary = '';
try {
  // Look for CHANGELOG.md: sibling konductor/ directory, then parent, then locally
  const changelogPaths = [
    join(rootDir, '..', 'konductor', 'CHANGELOG.md'),
    join(rootDir, '..', 'CHANGELOG.md'),
    join(rootDir, 'CHANGELOG.md'),
  ];

  let changelogContent = null;
  for (const p of changelogPaths) {
    try {
      changelogContent = readFileSync(p, 'utf8');
      break;
    } catch {
      // try next path
    }
  }

  if (changelogContent) {
    // Extract the first version heading and its content up to the next heading
    const lines = changelogContent.split('\n');
    let inFirstEntry = false;
    const entryLines = [];

    for (const line of lines) {
      if (line.startsWith('## ') && !inFirstEntry) {
        inFirstEntry = true;
        continue;
      } else if (line.startsWith('## ') && inFirstEntry) {
        break;
      }
      if (inFirstEntry) {
        entryLines.push(line);
      }
    }

    // Collapse to a single-line summary: take the first ### heading content or first non-empty lines
    const meaningful = entryLines
      .filter(l => l.trim() && !l.startsWith('###'))
      .map(l => l.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim())
      .filter(Boolean)
      .slice(0, 3);

    summary = meaningful.join('; ');
  }
} catch {
  // CHANGELOG not found or unreadable — summary stays empty
}

// 5. Write bundle-manifest.json
const manifest = { version, createdAt, author, summary };
const outPath = join(rootDir, 'bundle-manifest.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`Generated bundle-manifest.json: v${version} by ${author}`);
