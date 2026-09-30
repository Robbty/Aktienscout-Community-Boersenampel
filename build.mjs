/*
 * build.mjs — erzeugt die browser-spezifischen Builds aus dem geteilten Quellcode.
 *
 *   node build.mjs            -> dist/chrome und dist/firefox
 *                                + dist-test/chrome und dist-test/firefox
 *
 * Der gesamte Code in extension/ ist cross-browser. Pro Ziel unterscheidet sich
 * nur das Manifest (Background-Lademechanismus, gecko-Einstellungen). Chrome kann
 * weiterhin direkt aus extension/ geladen werden; dist/ ist für saubere Pakete.
 *
 * dist-test/ ist eine lokale Test-Variante (git-ignoriert): der DEBUG_SIMULATE-
 * Schalter steht dort auf 'noAccess' für Ampel UND Circle, sodass beide
 * Beitritts-Hinweise samt Affiliate-Links ohne Zweitaccount prüfbar sind.
 * Eigener Manifest-Name -> lässt sich parallel zur normalen Version laden.
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

// Test-Variante: normale Builds kopieren, Debug-Schalter aktivieren und im
// Manifest-Namen kennzeichnen.
async function buildTestVariant() {
  const out = join(root, 'dist-test');
  await rm(out, { recursive: true, force: true });
  for (const target of ['chrome', 'firefox']) {
    const dir = join(out, target);
    await mkdir(dir, { recursive: true });
    await cp(join(DIST, target), dir, { recursive: true });

    const debugPath = join(dir, 'lib', 'debug.js');
    const debugSrc = await readFile(debugPath, 'utf8');
    await writeFile(
      debugPath,
      debugSrc
        .replace('ampel: null,', "ampel: 'noAccess',")
        .replace('circle: null,', "circle: 'noAccess',"),
    );

    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.name += ' (TEST ohne Zugang)';
    if (manifest.browser_specific_settings && manifest.browser_specific_settings.gecko) {
      manifest.browser_specific_settings.gecko.id = 'boersenampel-watcher-test@aktienscout';
      // Die Test-Variante ist nie signiert und soll keine Updates suchen.
      delete manifest.browser_specific_settings.gecko.update_url;
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
  return out;
}

const chrome = await buildChrome();
const firefox = await buildFirefox();
const test = await buildTestVariant();
console.log('✓ Chrome  ->', chrome);
console.log('✓ Firefox ->', firefox);
console.log('✓ Test    ->', test, '(DEBUG_SIMULATE: beide auf noAccess)');
