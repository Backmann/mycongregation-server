/**
 * Inspect a JW Meeting Workbook EPUB to understand its structure.
 *
 * Usage:
 *   npx ts-node scripts/inspect-mwb.ts /path/to/mwb_R_YYYYMM.epub
 *
 * Outputs:
 *   - All files in the EPUB
 *   - For each XHTML file: title, headers (h1/h2/h3), distinct CSS classes
 *   - First weekly schedule page (heuristic: contains both "Сокровища" and "Изучение Библии")
 *     dumped in full so we can design the parser.
 */

import AdmZip from 'adm-zip';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

const epubPath = process.argv[2];

if (!epubPath) {
  console.error('Usage: ts-node scripts/inspect-mwb.ts <path-to-epub>');
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

// ---- 2. XHTML files overview ----
console.log('\n--- XHTML files overview ---');
const xhtmls = entries.filter(
  (e) => !e.isDirectory && /\.x?html$/i.test(e.entryName),
);

for (const e of xhtmls) {
  const content = e.getData().toString('utf8');
  const $ = cheerio.load(content, { xmlMode: true });

  const title = $('title').first().text().trim().slice(0, 80);
  const h1s = $('h1').map((_, el) => $(el).text().trim().slice(0, 60)).get();
  const h2s = $('h2').map((_, el) => $(el).text().trim().slice(0, 60)).get();
  const h3s = $('h3').map((_, el) => $(el).text().trim().slice(0, 60)).get();

  console.log(`\n  ${e.entryName}`);
  if (title) console.log(`    title:  ${title}`);
  if (h1s.length) console.log(`    h1:     ${JSON.stringify(h1s)}`);
  if (h2s.length) console.log(`    h2:     ${JSON.stringify(h2s.slice(0, 5))}${h2s.length > 5 ? '…' : ''}`);
  if (h3s.length) console.log(`    h3:     ${JSON.stringify(h3s.slice(0, 8))}${h3s.length > 8 ? '…' : ''}`);
}

// ---- 3. Find a "weekly programme" page ----
console.log('\n--- Looking for a weekly schedule page ---');
const weeklyMarkers = [
  'Сокровища',
  'СОКРОВИЩА',
  'Treasures',
  'TREASURES',
  'Изучение Библии в собрании',
  'CONGREGATION BIBLE STUDY',
];

const weekly = xhtmls.find((e) => {
  const text = e.getData().toString('utf8');
  return (
    weeklyMarkers.some((m) => text.includes(m)) &&
    text.includes('мин') // has Russian "min" duration markers
  );
});

if (!weekly) {
  // fallback: pick the first XHTML that looks like content (not metadata/cover)
  console.log('No clear weekly marker found. Trying fallback…');
  const fallback = xhtmls.find(
    (e) =>
      !/cover|nav|toc|copyright|title/i.test(e.entryName) &&
      e.getData().toString('utf8').length > 5000,
  );
  if (fallback) dumpWeeklyPage(fallback);
  else console.log('Could not find a content page.');
} else {
  dumpWeeklyPage(weekly);
}

function dumpWeeklyPage(entry: AdmZip.IZipEntry) {
  const content = entry.getData().toString('utf8');
  const $ = cheerio.load(content, { xmlMode: true });

  console.log(`\nWeekly page: ${entry.entryName}\n`);

  // ---- 3a. Distinct CSS classes used ----
  const classes = new Set<string>();
  $('[class]').each((_, el) => {
    const cls = $(el).attr('class');
    if (cls) cls.split(/\s+/).forEach((c) => c && classes.add(c));
  });
  console.log('--- Distinct CSS classes ---');
  console.log('  ' + Array.from(classes).sort().join(', '));

  // ---- 3b. Tag structure outline (depth-2 tags only, with classes) ----
  console.log('\n--- Body outline (top-level structure) ---');
  $('body > *, body > section > *').each((_, el) => {
    const tag = (el as any).tagName ?? (el as any).name;
    const cls = $(el).attr('class') ?? '';
    const text = $(el).text().trim().slice(0, 80).replace(/\s+/g, ' ');
    console.log(`  <${tag}${cls ? ` class="${cls}"` : ''}> ${text}`);
  });

  // ---- 3c. Full text dump (with structure markers) ----
  console.log('\n--- Full body text (numbered lines) ---');
  let n = 0;
  $('body')
    .find('h1, h2, h3, h4, p, li, span, div')
    .each((_, el) => {
      const tag = (el as any).tagName ?? (el as any).name;
      const cls = $(el).attr('class') ?? '';
      const text = $(el).clone().children().remove().end().text().trim();
      if (!text) return;
      n++;
      console.log(
        `  ${String(n).padStart(3)}. <${tag}${cls ? `.${cls}` : ''}> ${text.slice(0, 120)}`,
      );
      if (n >= 100) {
        console.log('  …(truncated at 100 lines)');
        return false;
      }
    });
}

console.log('\n=== Done ===\n');
