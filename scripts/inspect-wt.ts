/**
 * Inspect a JW Watchtower study EPUB to understand its structure.
 *
 * Usage:
 *   npx ts-node scripts/inspect-wt.ts /path/to/w_R_YYYYMM.epub
 *
 * Outputs:
 *   - All files in the EPUB (with sizes)
 *   - For each XHTML file: title, h1/h2/h3 headers
 *   - First study article page dumped in full
 */

import AdmZip from 'adm-zip';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

const epubPath = process.argv[2];

if (!epubPath) {
  console.error('Usage: ts-node scripts/inspect-wt.ts <path-to-epub>');
  process.exit(1);
}

if (!fs.existsSync(epubPath)) {
  console.error(`File not found: ${epubPath}`);
  process.exit(1);
}

console.log(`\n=== Inspecting: ${path.basename(epubPath)} ===\n`);

const zip = new AdmZip(epubPath);
const entries = zip.getEntries();

// ---- 1. All files ----
console.log('--- All files ---');
const files = entries
  .filter((e) => !e.isDirectory)
  .sort((a, b) => a.entryName.localeCompare(b.entryName));
for (const e of files) {
  const sizeKB = (e.header.size / 1024).toFixed(1);
  console.log(`  ${e.entryName.padEnd(60)} ${sizeKB.padStart(8)} KB`);
}

// ---- 2. XHTML overview ----
console.log('\n--- XHTML files overview ---');
const xhtmls = entries.filter(
  (e) => !e.isDirectory && /\.x?html$/i.test(e.entryName),
);

for (const e of xhtmls) {
  const content = e.getData().toString('utf8');
  const $ = cheerio.load(content, { xmlMode: true });

  const title = $('title').first().text().trim().slice(0, 80);
  const h1s = $('h1').map((_, el) => $(el).text().trim().slice(0, 80)).get();
  const h2s = $('h2').map((_, el) => $(el).text().trim().slice(0, 60)).get();
  const h3s = $('h3').map((_, el) => $(el).text().trim().slice(0, 60)).get();

  // Watchtower-specific: study date markers
  const text = content;
  const studyDateMatches = text.match(/Изучение[\s\S]{0,80}?года/gu);
  const songMatches = text.match(/Песн[яи]?\s*\d+/giu);

  console.log(`\n  ${e.entryName}`);
  if (title) console.log(`    title:  ${title}`);
  if (h1s.length) console.log(`    h1:     ${JSON.stringify(h1s.slice(0, 3))}${h1s.length > 3 ? '…' : ''}`);
  if (h2s.length) console.log(`    h2:     ${JSON.stringify(h2s.slice(0, 5))}${h2s.length > 5 ? '…' : ''}`);
  if (h3s.length) console.log(`    h3:     ${JSON.stringify(h3s.slice(0, 5))}${h3s.length > 5 ? '…' : ''}`);
  if (studyDateMatches) {
    console.log(`    study-dates: ${JSON.stringify(studyDateMatches.slice(0, 2).map((s) => s.replace(/\s+/g, ' ').trim().slice(0, 80)))}`);
  }
  if (songMatches && songMatches.length > 0) {
    console.log(`    songs:  ${songMatches.slice(0, 3).join(', ')}${songMatches.length > 3 ? '…' : ''}`);
  }
}

// ---- 3. Find a study article page ----
console.log('\n\n--- Looking for a study article page ---');
const studyMarkers = [
  'Изучение',
  'ИЗУЧЕНИЕ',
  'study article',
  'STUDY ARTICLE',
];

const studyPage = xhtmls.find((e) => {
  const text = e.getData().toString('utf8');
  return (
    studyMarkers.some((m) => text.includes(m)) &&
    /Песн[яи]?\s*\d+/iu.test(text) && // has song reference
    e.getData().toString('utf8').length > 5000
  );
});

if (!studyPage) {
  console.log('No study article page detected with markers. Trying fallback…');
  const fallback = xhtmls.find(
    (e) =>
      !/cover|nav|toc|copyright|title|navigation/i.test(e.entryName) &&
      e.getData().toString('utf8').length > 8000,
  );
  if (fallback) dumpStudyPage(fallback);
  else console.log('Could not find a content page.');
} else {
  dumpStudyPage(studyPage);
}

function dumpStudyPage(entry: AdmZip.IZipEntry) {
  const content = entry.getData().toString('utf8');
  const $ = cheerio.load(content, { xmlMode: true });

  console.log(`\nStudy page: ${entry.entryName}\n`);

  // ---- 3a. Distinct CSS classes ----
  const classes = new Set<string>();
  $('[class]').each((_, el) => {
    const cls = $(el).attr('class');
    if (cls) cls.split(/\s+/).forEach((c) => c && classes.add(c));
  });
  console.log('--- Distinct CSS classes ---');
  console.log('  ' + Array.from(classes).sort().join(', '));

  // ---- 3b. Top-level structure ----
  console.log('\n--- Body outline (top-level structure) ---');
  $('body > *, body > article > *, body > section > *').each((_, el) => {
    const tag = (el as any).tagName ?? (el as any).name;
    const cls = $(el).attr('class') ?? '';
    const text = $(el).text().trim().slice(0, 80).replace(/\s+/g, ' ');
    console.log(`  <${tag}${cls ? ` class="${cls}"` : ''}> ${text}`);
  });

  // ---- 3c. Full structured dump ----
  console.log('\n--- Full body text (numbered lines, first 80) ---');
  let n = 0;
  $('body')
    .find('h1, h2, h3, h4, p, span')
    .each((_, el) => {
      const tag = (el as any).tagName ?? (el as any).name;
      const cls = $(el).attr('class') ?? '';
      const text = $(el).clone().children().remove().end().text().trim().replace(/\s+/g, ' ');
      if (!text) return;
      n++;
      console.log(
        `  ${String(n).padStart(3)}. <${tag}${cls ? `.${cls}` : ''}> ${text.slice(0, 130)}`,
      );
      if (n >= 80) {
        console.log('  …(truncated at 80 lines)');
        return false;
      }
    });
}

console.log('\n=== Done ===\n');
