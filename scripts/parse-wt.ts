/**
 * CLI parser for Watchtower study EPUBs.
 *
 * Usage:
 *   npx ts-node scripts/parse-wt.ts /path/to/w_X_YYYYMM.epub
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  extractYearFromFilename,
  parseWtBuffer,
} from '../src/wt-import/wt-parser';

const epubPath = process.argv[2];

if (!epubPath) {
  console.error('Usage: ts-node scripts/parse-wt.ts <path-to-epub>');
  process.exit(1);
}

if (!fs.existsSync(epubPath)) {
  console.error(`File not found: ${epubPath}`);
  process.exit(1);
}

const epubBase = path.basename(epubPath);
const year = extractYearFromFilename(epubPath);

console.log(`\n=== Parsing ${epubBase} (year=${year}) ===\n`);

const buffer = fs.readFileSync(epubPath);
const result = parseWtBuffer(buffer, year, epubBase);

const outPath = path.join(os.tmpdir(), 'wt-parsed.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

console.log(`Found ${result.weeks.length} study articles\n`);
console.log('=== Per-week summary ===\n');

for (const w of result.weeks) {
  const songs = `♪${w.openingSong ?? '?'}/${w.closingSong ?? '?'}`;
  console.log(
    `  ${w.weekStartDate} → ${w.weekEndDate}  ${songs.padEnd(8)} ${w.articleTitle.slice(0, 60)}`,
  );
}

if (result.errors.length > 0) {
  console.log('\nErrors:');
  result.errors.forEach((e) => console.log(`  ${e}`));
}

if (result.weeks.length > 0) {
  const w = result.weeks[0];
  console.log(`\n=== Week 1 detailed parts ===\n`);
  for (const p of w.parts) {
    const flag = p.synthetic ? '★' : '✓';
    const dur = p.durationMin !== null ? `${p.durationMin}m` : '—';
    const title = p.partTitle ?? '(synthetic)';
    console.log(
      `  ${flag} [${p.partOrder}] ${p.partKey.padEnd(28)} ${dur.padEnd(5)} ${title.slice(0, 70)}`,
    );
  }
}

console.log(`\nFull JSON: ${outPath}\n`);
