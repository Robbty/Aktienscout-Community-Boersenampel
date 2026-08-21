/*
 * build-www.mjs — assembliert www/ für die Android-App aus ../extension.
 *
 *   node build-www.mjs        (dann: npx cap sync android)
 *
 * extension/ bleibt die einzige Quelle der Wahrheit; hier wird nur kopiert und
 * minimal-invasiv umgebaut (gleiche String-Replace-Technik wie build.mjs im
 * Repo-Wurzelverzeichnis, bewusst ohne npm-Abhängigkeiten):
 *  - index.html aus popup.html: Viewport-Meta, app.css, App-Skriptblock
 *  - background.js in eine IIFE gewickelt (kollidiert sonst mit popup.js:
 *    beide deklarieren Top-Level `const api` und `popupPort`)
 *  - chart.html: Viewport-Meta + Zurück-Knopf (die App hat keine Fensterleiste)
 *  - NICHT kopiert: Manifeste, content.js (kein Tab auf skool.com)
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'extension');
const OUT = join(here, 'www');

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// 1) Unveränderte Teile kopieren.
for (const name of ['popup.css', 'popup.js', 'chart.js', 'chart.css', 'lib', 'icons']) {
  await cp(join(SRC, name), join(OUT, name), { recursive: true });
}
await cp(join(here, 'src', 'app.css'), join(OUT, 'app.css'));
await cp(join(here, 'src', 'app.js'), join(OUT, 'app.js'));
await cp(join(here, 'src', 'shim.js'), join(OUT, 'shim.js'));

// 2) background.js -> IIFE.
const bg = await readFile(join(SRC, 'background.js'), 'utf8');
await writeFile(join(OUT, 'background.iife.js'), '(function () {\n' + bg + '\n})();\n');

// 3) index.html aus popup.html generieren.
let html = await readFile(join(SRC, 'popup.html'), 'utf8');
const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1" />';
html = html.replace('<meta charset="utf-8" />', '<meta charset="utf-8" />\n  ' + viewport);
html = html.replace(
  '<link rel="stylesheet" href="popup.css" />',
  '<link rel="stylesheet" href="popup.css" />\n  <link rel="stylesheet" href="app.css" />',
);
const scriptBlock =
  '<script src="shim.js"></script>\n' +
  '  <script src="lib/debug.js"></script>\n' +
  '  <script src="lib/ampel.js"></script>\n' +
  '  <script src="lib/circle.js"></script>\n' +
  '  <script src="lib/quotes.js"></script>\n' +
  '  <script src="background.iife.js"></script>\n' +
  '  <script src="popup.js"></script>\n' +
  '  <script src="app.js"></script>';
const oldBlock =
  '<script src="lib/ampel.js"></script>\n' +
  '  <script src="lib/circle.js"></script>\n' +
  '  <script src="popup.js"></script>';
if (!html.includes(oldBlock)) throw new Error('popup.html: Skriptblock nicht gefunden — Marker anpassen!');
html = html.replace(oldBlock, scriptBlock);
await writeFile(join(OUT, 'index.html'), html);

// 4) chart.html: Viewport + Zurück-Knopf (Android-Hardware-Zurück geht auch,
//    aber ein sichtbarer Weg zurück ist auf dem Handy Pflicht).
let chart = await readFile(join(SRC, 'chart.html'), 'utf8');
chart = chart.replace('<meta charset="utf-8" />', '<meta charset="utf-8" />\n  ' + viewport);
const backSnippet =
  '<button type="button" style="position:fixed;right:10px;bottom:10px;z-index:9;padding:8px 14px;' +
  'border:1px solid #ccc;border-radius:8px;background:#fff;font-size:14px;" ' +
  'onclick="history.back()">‹ Zurück</button>\n</body>';
if (!chart.includes('</body>')) throw new Error('chart.html: </body> nicht gefunden!');
chart = chart.replace('</body>', backSnippet);
await writeFile(join(OUT, 'chart.html'), chart);

// 5) Syntax-Check der generierten/kopierten Skripte.
for (const f of ['background.iife.js', 'shim.js', 'app.js', 'popup.js']) {
  execFileSync(process.execPath, ['--check', join(OUT, f)]);
}

console.log('✓ www/ ->', OUT);
