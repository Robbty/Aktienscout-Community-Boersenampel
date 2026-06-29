/*
 * build.mjs — erzeugt die browser-spezifischen Builds aus dem geteilten Quellcode.
 *
 *   node build.mjs            -> dist/chrome und dist/firefox
 *
 * Der gesamte Code in extension/ ist cross-browser. Pro Ziel unterscheidet sich
 * nur das Manifest (Background-Lademechanismus, gecko-Einstellungen). Chrome kann
 * weiterhin direkt aus extension/ geladen werden; dist/ ist für saubere Pakete.
 */
import { cp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const SRC = join(root, 'extension');
const DIST = join(root, 'dist');

// Dateien, die NICHT 1:1 ins Paket gehören (Manifeste werden gezielt gesetzt).
const SKIP = new Set(['manifest.json', 'manifest.firefox.json']);

async function copyShared(target) {
  const entries = await readdir(SRC, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    await cp(join(SRC, e.name), join(target, e.name), { recursive: true });
  }
}

async function buildChrome() {
  const out = join(DIST, 'chrome');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await copyShared(out);
  // extension/manifest.json ist bereits die Chrome-Variante.
  await cp(join(SRC, 'manifest.json'), join(out, 'manifest.json'));
  return out;
}

async function buildFirefox() {
  const out = join(DIST, 'firefox');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await copyShared(out);
  const ff = await readFile(join(SRC, 'manifest.firefox.json'), 'utf8');
  await writeFile(join(out, 'manifest.json'), ff);
  return out;
}

const chrome = await buildChrome();
const firefox = await buildFirefox();
console.log('✓ Chrome  ->', chrome);
console.log('✓ Firefox ->', firefox);
