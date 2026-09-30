/*
 * release-firefox.mjs — signiert das Firefox-Add-on bei Mozilla und gibt es frei.
 *
 *   node tools/release-firefox.mjs check            Vorprüfungen + web-ext lint
 *   node tools/release-firefox.mjs sign             -> web-ext-artifacts/boersenampel-firefox-<version>.xpi
 *   node tools/release-firefox.mjs publish [xpi]    GitHub-Release "firefox" + updates.json
 *
 * Warum: Firefox installiert nur von Mozilla signierte Add-ons dauerhaft. Wir
 * nutzen die "Self-Distribution" (Kanal unlisted): Mozilla signiert automatisch,
 * es gibt keinen Store-Eintrag, die .xpi liegt bei uns (GitHub-Release).
 *
 * Schlüssel: WEB_EXT_API_KEY / WEB_EXT_API_SECRET aus der Umgebung oder aus der
 * git-ignorierten Datei .amo-credentials (https://addons.mozilla.org/developers/addon/api/key/).
 *
 * Reihenfolge einer Freigabe (siehe CLAUDE.md "Firefox-Freigabe"):
 *   Version + Changelog -> node build.mjs -> sign -> signierte Datei testen ->
 *   publish -> updates.json + Doku committen und pushen.
 * Mozilla signiert jede Versionsnummer nur EINMAL: jede Änderung am Firefox-Paket
 * braucht eine neue Version.
 *
 * sign und publish sind getrennt, weil Mozilla eine Einreichung auch erst später
 * freigeben kann — dann die .xpi aus dem Entwickler-Bereich laden und publish
 * mit ihrem Pfad aufrufen.
 *
 * Ohne npm-Abhängigkeiten: web-ext läuft nur über npx, das Stammprojekt bleibt
 * ohne package.json.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync, copyFileSync, mkdtempSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'extension');
const DIST_FF = join(root, 'dist', 'firefox');
const ARTIFACTS = join(root, 'web-ext-artifacts');
const UPDATES = join(root, 'updates.json');

const REPO = 'Robbty/Aktienscout-Community-Boersenampel';
// EIN fortlaufendes Release für alle Firefox-Versionen: die Anleitung braucht
// einen Link, der sich nie ändert (STABLE_NAME wird je Version überschrieben).
const RELEASE_TAG = 'firefox';
const STABLE_NAME = 'boersenampel-firefox.xpi';
const versionedName = (v) => `boersenampel-firefox-${v}.xpi`;
const downloadUrl = (name) => `https://github.com/${REPO}/releases/download/${RELEASE_TAG}/${name}`;

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(relative(base, p));
  }
  return out;
}

// dist/firefox muss exakt dem Quellstand entsprechen — signiert wird dist/.
function checkDistFresh() {
  if (!existsSync(join(DIST_FF, 'manifest.json'))) fail('dist/firefox fehlt — erst `node build.mjs`.');
  const stale = [];
  if (readFileSync(join(SRC, 'manifest.firefox.json'), 'utf8') !== readFileSync(join(DIST_FF, 'manifest.json'), 'utf8')) {
    stale.push('manifest.json');
  }
  for (const f of listFiles(SRC)) {
    if (f === 'manifest.json' || f === 'manifest.firefox.json') continue;
    const d = join(DIST_FF, f);
    if (!existsSync(d) || !readFileSync(join(SRC, f)).equals(readFileSync(d))) stale.push(f);
  }
  if (stale.length) fail('dist/firefox ist nicht aktuell (' + stale.slice(0, 5).join(', ') + ') — erst `node build.mjs`.');
}

function preflight() {
  checkDistFresh();
  const manifest = readJson(join(DIST_FF, 'manifest.json'));
  const gecko = (manifest.browser_specific_settings || {}).gecko || {};
  const version = manifest.version;
  if (!gecko.id) fail('Manifest ohne gecko.id.');
  if (!gecko.update_url) fail('Manifest ohne gecko.update_url — ohne sie gibt es keine automatischen Updates.');
  if (!gecko.data_collection_permissions) fail('Manifest ohne gecko.data_collection_permissions (Pflicht bei Mozilla).');
  const chromeVersion = readJson(join(SRC, 'manifest.json')).version;
  if (chromeVersion !== version) fail(`Versionen ungleich: Firefox ${version}, Chrome ${chromeVersion}.`);
  const changelog = readFileSync(join(SRC, 'changelog.md'), 'utf8');
  if (!changelog.split('\n').some((l) => l.startsWith(`## ${version} `))) {
    fail(`extension/changelog.md hat keinen Eintrag "## ${version} – Datum".`);
  }
  const updates = readJson(UPDATES);
  const entry = updates.addons && updates.addons[gecko.id];
  if (!entry || !Array.isArray(entry.updates)) fail(`updates.json hat keinen Block für ${gecko.id}.`);
  if (entry.updates.some((u) => u.version === version)) {
    fail(`Version ${version} steht schon in updates.json — Mozilla signiert jede Version nur einmal. Erst die Version erhöhen.`);
  }
  return { manifest, gecko, version, updates };
}

function credentials() {
  const env = { ...process.env };
  const file = join(root, '.amo-credentials');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*(WEB_EXT_API_(?:KEY|SECRET))\s*=\s*(.*?)\s*$/.exec(line);
      if (m && m[2] && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  if (!env.WEB_EXT_API_KEY || !env.WEB_EXT_API_SECRET) {
    fail('Mozilla-API-Schlüssel fehlt. In .amo-credentials eintragen (WEB_EXT_API_KEY / WEB_EXT_API_SECRET),\n'
      + '  erzeugen unter https://addons.mozilla.org/developers/addon/api/key/');
  }
  return env;
}

function webExt(args, env = process.env) {
  const r = spawnSync('npx', ['--yes', 'web-ext', ...args], { cwd: root, env, stdio: 'inherit' });
  return r.status === 0;
}

function lint() {
  // --self-hosted: sonst meldet der Linter die update_url als Fehler (die ist
  // nur für Store-Einträge verboten).
  if (!webExt(['lint', '--self-hosted', '--source-dir', DIST_FF])) fail('web-ext lint meldet Fehler.');
}

// Kleinster ZIP-Leser: eine Datei aus dem Archiv holen (Zentralverzeichnis ->
// lokaler Kopf -> inflate). Reicht, um die signierte .xpi zu prüfen.
function zipRead(buf, name) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + compSize);
      return method === 0 ? Buffer.from(data) : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function checkSignedXpi(file, gecko, version) {
  if (!existsSync(file)) fail(`Datei nicht gefunden: ${file}`);
  const buf = readFileSync(file);
  if (!zipRead(buf, 'META-INF/mozilla.rsa')) fail(`${file} trägt keine Mozilla-Signatur (META-INF/mozilla.rsa fehlt).`);
  const raw = zipRead(buf, 'manifest.json');
  if (!raw) fail(`${file} enthält kein manifest.json.`);
  const m = JSON.parse(raw.toString('utf8'));
  const id = ((m.browser_specific_settings || {}).gecko || {}).id;
  if (m.version !== version) fail(`Die .xpi ist Version ${m.version}, das Projekt steht auf ${version}.`);
  if (id !== gecko.id) fail(`Die .xpi hat die ID ${id}, erwartet ${gecko.id}.`);
  return buf;
}

function gh(args, opts = {}) {
  return execFileSync('gh', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'inherit'] });
}

function cmdCheck() {
  const { version } = preflight();
  lint();
  console.log(`✓ Version ${version} ist bereit zum Signieren.`);
}

function cmdSign() {
  const { version } = preflight();
  const env = credentials();
  lint();
  const before = new Set(existsSync(ARTIFACTS) ? readdirSync(ARTIFACTS) : []);
  console.log(`… Mozilla signiert Version ${version} (dauert meist ein paar Minuten)`);
  const ok = webExt(['sign', '--channel=unlisted', '--source-dir', DIST_FF, '--artifacts-dir', ARTIFACTS], env);
  const fresh = (existsSync(ARTIFACTS) ? readdirSync(ARTIFACTS) : [])
    .filter((f) => f.endsWith('.xpi') && !before.has(f))
    .sort((a, b) => statSync(join(ARTIFACTS, b)).mtimeMs - statSync(join(ARTIFACTS, a)).mtimeMs);
  if (!ok || !fresh.length) {
    fail('Keine signierte Datei erhalten. Hat Mozilla die Einreichung zur Prüfung zurückgestellt, liegt sie später unter\n'
      + '  https://addons.mozilla.org/developers/addons — dort laden und `publish <datei.xpi>` aufrufen.');
  }
  const target = join(ARTIFACTS, versionedName(version));
  renameSync(join(ARTIFACTS, fresh[0]), target);
  console.log('✓ Signiert ->', target);
  console.log('  Jetzt in einem frischen Firefox-Profil testen, dann: node tools/release-firefox.mjs publish');
}

function cmdPublish(arg) {
  const { gecko, version, updates } = preflight();
  const file = arg ? resolve(arg) : join(ARTIFACTS, versionedName(version));
  const buf = checkSignedXpi(file, gecko, version);
  const hash = 'sha256:' + createHash('sha256').update(buf).digest('hex');

  const tmp = mkdtempSync(join(tmpdir(), 'boersenampel-xpi-'));
  const versioned = join(tmp, versionedName(version));
  const stable = join(tmp, STABLE_NAME);
  copyFileSync(file, versioned);
  copyFileSync(file, stable);

  let exists = true;
  try { gh(['release', 'view', RELEASE_TAG, '--json', 'tagName'], { quiet: true }); } catch (e) { exists = false; }
  if (!exists) {
    // --latest=false ist zwingend: der In-App-Updater der Android-App und der
    // README-Link lesen releases/latest — das muss das App-Release bleiben.
    gh(['release', 'create', RELEASE_TAG, '--latest=false',
      '--title', 'Börsenampel für Firefox',
      '--notes', [
        'Die Börsenampel als **dauerhaft installierbares Firefox-Add-on** (von Mozilla signiert).',
        '',
        `**Installieren:** in Firefox auf **${STABLE_NAME}** klicken → „Installation fortsetzen" → „Hinzufügen".`,
        'Das Add-on bleibt nach dem Schließen von Firefox erhalten und aktualisiert sich von selbst.',
        '',
        `Anleitung: https://github.com/${REPO}/blob/main/ANLEITUNG.md`,
        '',
        `Die Dateien mit Versionsnummer sind die einzelnen Ausgaben; ${STABLE_NAME} ist immer die neueste.`,
      ].join('\n')]);
  }
  gh(['release', 'upload', RELEASE_TAG, versioned, stable, '--clobber']);

  updates.addons[gecko.id].updates.push({
    version,
    update_link: downloadUrl(versionedName(version)),
    update_hash: hash,
    applications: { gecko: { strict_min_version: gecko.strict_min_version } },
  });
  writeFileSync(UPDATES, JSON.stringify(updates, null, 2) + '\n');

  const latest = gh(['api', `repos/${REPO}/releases/latest`, '--jq', '.tag_name'], { quiet: true }).trim();
  console.log('✓ Hochgeladen:', downloadUrl(STABLE_NAME));
  console.log('✓ updates.json ergänzt (' + version + ')');
  if (!latest.startsWith('app-v')) {
    console.error(`✗ ACHTUNG: releases/latest zeigt auf "${latest}" statt auf ein App-Release — der In-App-Updater der`
      + ` Android-App liest das.\n  Beheben: gh release edit ${RELEASE_TAG} --latest=false`);
    process.exitCode = 1;
  }
  console.log('  Jetzt updates.json (und die Doku) committen und pushen — erst damit sehen installierte Add-ons das Update.');
}

const cmd = process.argv[2];
if (cmd === 'check') cmdCheck();
else if (cmd === 'sign') cmdSign();
else if (cmd === 'publish') cmdPublish(process.argv[3]);
else {
  console.error('Aufruf: node tools/release-firefox.mjs check | sign | publish [datei.xpi]');
  process.exit(1);
}
