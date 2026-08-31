/*
 * md2pdf.mjs — Markdown-Anleitung -> PDF mit farbigen Emoji.
 *
 *   node tools/md2pdf.mjs ANLEITUNG-APP.md            (-> ANLEITUNG-APP.pdf daneben)
 *   node tools/md2pdf.mjs ANLEITUNG-APP.md ziel.pdf
 *
 * Warum nicht ReText/Qt oder LibreOffice: die betten "Noto Color Emoji" als
 * Umriss-Schrift ein, die Schrift hat aber nur Bitmaps -> Emoji verschwinden.
 * Chrome (headless) rastert Farb-Emoji korrekt ins PDF. Ohne npm-Abhängigkeiten:
 * ein kleiner Markdown-Konverter reicht für die Anleitungen (Überschriften,
 * Listen, Fett/Kursiv/Code, Links, Zitate, Trennlinien, Bilder, Tabellen).
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';

const src = process.argv[2];
if (!src) { console.error('Aufruf: node tools/md2pdf.mjs <datei.md> [ziel.pdf]'); process.exit(1); }
const out = process.argv[3] || src.replace(/\.md$/i, '') + '.pdf';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(„])\*([^*\n]+)\*(?=[\s).,;:!?“]|$)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  return s;
}

function toHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  const listStack = []; // { type, indent }
  const closeLists = (toIndent = -1) => {
    while (listStack.length && listStack[listStack.length - 1].indent > toIndent) html.push('</' + listStack.pop().type + '>');
  };
  let para = [];
  const flushPara = () => { if (para.length) { html.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };

  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara(); closeLists();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flushPara(); closeLists(); html.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); closeLists(); html.push('<hr>'); i++; continue; }
    if (/^>/.test(line)) {
      flushPara(); closeLists();
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      html.push('<blockquote>' + toHtml(buf.join('\n')) + '</blockquote>');
      continue;
    }
    if (/^\|/.test(line)) {
      flushPara(); closeLists();
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      let t = '<table>';
      rows.forEach((r, k) => {
        if (/^\|?\s*:?-{2,}/.test(r)) return;
        const tag = k === 0 ? 'th' : 'td';
        t += '<tr>' + cells(r).map((c) => '<' + tag + '>' + inline(c) + '</' + tag + '>').join('') + '</tr>';
      });
      html.push(t + '</table>');
      continue;
    }
    const li = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const indent = li[1].length;
      const type = /\d/.test(li[2]) ? 'ol' : 'ul';
      closeLists(indent);
      const top = listStack[listStack.length - 1];
      if (!top || top.indent < indent || top.type !== type) {
        if (top && top.indent === indent && top.type !== type) html.push('</' + listStack.pop().type + '>');
        listStack.push({ type, indent });
        // Nummerierung übernehmen ("3." nach einem Zwischenabsatz zählt weiter).
        const start = type === 'ol' ? parseInt(li[2], 10) : 1;
        html.push('<' + type + (start > 1 ? ' start="' + start + '"' : '') + '>');
      }
      // Folgezeilen des Listenpunkts (eingerückt) anhängen.
      let text = li[3];
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i + 1])) text += ' ' + lines[++i].trim();
      html.push('<li>' + inline(text) + '</li>');
      i++;
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      // Liste nur schließen, wenn danach weder Einrückung noch ein weiterer Punkt folgt.
      const next = lines[i + 1] || '';
      if (!/^\s+/.test(next) && !/^\s*([-*+]|\d+\.)\s+/.test(next)) closeLists();
      i++;
      continue;
    }
    if (listStack.length && /^\s+/.test(line)) {
      // Eingerückter Absatz gehört IN den letzten Listenpunkt (Liste bleibt offen).
      const buf = [line.trim()];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i + 1])) buf.push(lines[++i].trim());
      const cont = '<p class="cont">' + inline(buf.join(' ')) + '</p>';
      for (let k = html.length - 1; k >= 0; k--) {
        if (html[k].endsWith('</li>')) { html[k] = html[k].slice(0, -5) + cont + '</li>'; break; }
      }
      i++;
      continue;
    }
    closeLists();
    para.push(line.trim());
    i++;
  }
  flushPara(); closeLists();
  return html.join('\n');
}

const md = readFileSync(src, 'utf8');
const body = toHtml(md);
const title = (/^#\s+(.*)$/m.exec(md) || [, basename(src)])[1].replace(/[#*`]/g, '');
const page = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font: 11.5pt/1.5 "Noto Sans", "DejaVu Sans", system-ui, sans-serif; color: #202124; max-width: 100%; }
  h1 { font-size: 22pt; margin: 0 0 8pt; }
  h2 { font-size: 15pt; margin: 20pt 0 6pt; border-bottom: 1px solid #ddd; padding-bottom: 3pt; page-break-after: avoid; }
  h3 { font-size: 12.5pt; margin: 14pt 0 4pt; page-break-after: avoid; }
  p { margin: 0 0 8pt; }
  ul, ol { margin: 0 0 8pt; padding-left: 22pt; }
  li { margin: 2pt 0; }
  li > p.cont { margin: 2pt 0 0; }
  code { font: 10pt "DejaVu Sans Mono", monospace; background: #f1f3f4; padding: 1pt 3pt; border-radius: 3pt; }
  pre { background: #f1f3f4; padding: 8pt; border-radius: 4pt; white-space: pre-wrap; }
  blockquote { margin: 8pt 0; padding: 6pt 10pt; border-left: 3pt solid #d4a017; background: #fffbea; }
  blockquote p:last-child { margin-bottom: 0; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 14pt 0; }
  a { color: #1a73e8; word-break: break-all; }
  img { max-width: 100%; display: block; margin: 6pt auto; page-break-inside: avoid; }
  table { border-collapse: collapse; margin: 8pt 0; }
  th, td { border: 1px solid #ddd; padding: 3pt 6pt; text-align: left; }
</style></head><body>${body}</body></html>`;

const htmlPath = resolve(dirname(src), '.' + basename(src, '.md') + '.md2pdf.html');
writeFileSync(htmlPath, page);
const chrome = ['google-chrome', 'chromium', 'chromium-browser', 'chrome'].find((c) => {
  try { execFileSync('which', [c], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!chrome) { console.error('Kein Chrome/Chromium gefunden.'); process.exit(1); }
try {
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
    '--print-to-pdf=' + resolve(out), 'file://' + htmlPath,
  ], { stdio: 'ignore', timeout: 120000 });
} finally {
  if (existsSync(htmlPath)) unlinkSync(htmlPath);
}
console.log('✓', out);
