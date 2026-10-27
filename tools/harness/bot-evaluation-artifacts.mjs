import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const hash = content => createHash('sha256').update(content).digest('hex');
export const stringify = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? { $bigint: String(item) } : item);
export const parse = value => JSON.parse(value, (_, item) => item && typeof item === 'object' && '$bigint' in item ? BigInt(item.$bigint) : item);
export const promptHash = prompt => hash(stringify(prompt));

export function treeHash(path, filter = () => true) {
  const h = createHash('sha256');
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name.startsWith('.')) continue;
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (filter(file)) h.update(relative(path, file)).update(readFileSync(file));
    }
  }
  walk(path);
  return h.digest('hex');
}

export function runtimeIdentity(scriptsDir) {
  return { node: process.version, platform: process.platform, arch: process.arch,
    revision: execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status','--porcelain'], { encoding:'utf8' }).trim()),
    sourceHash: treeHash('src', file => /\.(ts|tsx|json)$/.test(file)),
    dataHash: treeHash('src/data'), coreHash: treeHash('node_modules/@n1xx1/ocgcore-wasm/lib'),
    harnessHash: treeHash('tools/harness', file => /\.(mjs|ts)$/.test(file) && !file.includes('/baselines/')),
    scriptsHash: treeHash(scriptsDir, file => file.endsWith('.lua')),
    patchesHash: hash(readFileSync('src/lib/duel/script-patches.ts')),
    patchesDisabled: process.env.SKIP_SCRIPT_PATCHES === '1', lockHash: hash(readFileSync('package-lock.json')) };
}

export async function loadBaseline(path) {
  const directory = resolve(path);
  const manifest = JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
  for (const [name, file] of Object.entries(manifest.files)) {
    const absolute = resolve(directory, name);
    if (!absolute.startsWith(directory + '/') || !existsSync(absolute) || hash(readFileSync(absolute)) !== file.sha256) {
      throw new Error(`Referência corrompida: ${name}`);
    }
  }
  return { directory, manifest, hash: hash(readFileSync(join(directory,'manifest.json'))),
    brain: await import(pathToFileURL(join(directory,manifest.entry)).href),
    profiles: await import(pathToFileURL(join(directory,'src/lib/duel/bot/deck-profile.mjs')).href),
    auto: await import(pathToFileURL(join(directory,'src/lib/duel/auto-response.mjs')).href) };
}
