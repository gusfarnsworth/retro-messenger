#!/usr/bin/env node
/**
 * Retro Messenger: synchronise the version used by npm, Tauri, Cargo,
 * the public website announcement, and any existing lockfiles.
 *
 * Install as: scripts/set-retro-version.mjs
 * Run from anywhere: node scripts/set-retro-version.mjs 1.1.2
 *
 * Does not commit, push, publish, sign, or touch any credentials.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!target || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(target)) {
  console.error('Usage: node scripts/set-retro-version.mjs 1.1.2');
  process.exit(1);
}

const changes = [];
function read(relativePath, required = true) {
  const full = join(root, relativePath);
  if (!existsSync(full)) {
    if (required) throw new Error(`Missing required file: ${relativePath}`);
    return null;
  }
  return readFileSync(full, 'utf8');
}
function stage(relativePath, content, original) {
  if (content !== original) changes.push({relativePath, content});
}
function updateJson(relativePath, mutate, required = true) {
  const original = read(relativePath, required);
  if (original === null) return;
  const value = JSON.parse(original);
  mutate(value);
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  stage(relativePath, JSON.stringify(value, null, 2).replace(/\n/g, eol) + eol, original);
}

try {
  updateJson('package.json', data => { data.version = target; });
  updateJson('src-tauri/tauri.conf.json', data => { data.version = target; });
  // Only update this file if present. It is a public web announcement,
  // NOT the signed GitHub latest.json updater manifest.
  updateJson('public/updates.json', data => { data.version = target; }, false);

  // npm package-lock v2/v3: top-level version and root packages[''].version.
  updateJson('package-lock.json', data => {
    data.version = target;
    if (data.packages?.['']) data.packages[''].version = target;
  }, false);

  const cargoPath = 'src-tauri/Cargo.toml';
  const cargo = read(cargoPath);
  const packageHeader = /^\[package\]\s*\r?\n/m;
  const headerMatch = packageHeader.exec(cargo);
  if (!headerMatch) throw new Error(`${cargoPath} has no [package] section`);
  const start = headerMatch.index + headerMatch[0].length;
  const nextHeader = cargo.slice(start).search(/^\[/m);
  const end = nextHeader === -1 ? cargo.length : start + nextHeader;
  const section = cargo.slice(start, end);
  const versionLine = /^(\s*version\s*=\s*")[^"]+("[ \t]*)$/m;
  if (!versionLine.test(section)) throw new Error(`${cargoPath} has no package version`);
  const updatedSection = section.replace(versionLine, (_, prefix, suffix) => prefix + target + suffix);
  stage(cargoPath, cargo.slice(0, start) + updatedSection + cargo.slice(end), cargo);

  // Existing Cargo.lock: keep its root package version in step with Cargo.toml.
  const lockPath = 'src-tauri/Cargo.lock';
  const lock = read(lockPath, false);
  if (lock !== null) {
    let found = 0;
    const blocks = lock.split(/(?=^\[\[package\]\])/m);
    const updated = blocks.map(block => {
      if (!/^\[\[package\]\]/.test(block) || !/^name\s*=\s*"retro-messenger"\s*$/m.test(block)) return block;
      found++;
      if (!/^version\s*=\s*"[^"]+"\s*$/m.test(block)) throw new Error(`${lockPath}: root package has no version`);
      return block.replace(/^(version\s*=\s*")[^"]+("\s*)$/m, (_, a, b) => a + target + b);
    }).join('');
    if (found !== 1) throw new Error(`${lockPath}: expected one retro-messenger package, found ${found}`);
    stage(lockPath, updated, lock);
  }

  for (const item of changes) writeFileSync(join(root, item.relativePath), item.content, 'utf8');
  if (changes.length === 0) console.log(`Retro Messenger is already set to v${target}.`);
  else {
    console.log(`Retro Messenger version updated to v${target}:`);
    for (const item of changes) console.log(`  ✓ ${item.relativePath}`);
  }
  console.log('\nNext: npm run updater:verify && npm run build');
  console.log('Then: git add . && git commit -m "Release Retro Messenger v' + target + '" && git push origin main');
  console.log('Finally, start the signed Windows release workflow on GitHub Actions.');
} catch (error) {
  console.error('Version update stopped:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
