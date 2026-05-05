/**
 * CLI inspector for MWB EPUBs. Imports parser from src/mwb-import/mwb-parser.
 *
 * Usage:
 *   npx ts-node scripts/parse-mwb.ts /path/to/mwb_X_YYYYMM.epub
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  extractYearFromFilename,
  parseMwbBuffer,
} from '../src/mwb-import/mwb-parser';

const epubPath = process.argv[2];

if (!epubPath) {
  console.error('Usage: ts-node scripts/parse-mwb.ts <path-to-epub>');
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
const result = parseMwbBuffer(buffer, year, epubBase);

const outPath = path.join(os.tmpdir(), 'mwb-parsed.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

console.log('=== Per-week summary ===\n');
for (const w of result.weeks) {
  const realParts = w.parts.filter((p) => !p.synthetic).length;
  const synth = w.parts.filter((p) => p.synthetic).length;
  const unknowns = w.parts.filter((p) => p.partKey === 'unknown').length;
  const flag = unknowns > 0 ? '⚠' : '✓';
  console.log(
    `${flag}  ${w.weekStartDate} → ${w.weekEndDate}  ${w.biblePassage.padEnd(20)}  ` +
      `${realParts} parts + ${synth} synthetic = ${w.parts.length} total` +
      (unknowns > 0 ? ` (${unknowns} unclassified)` : ''),
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
    const conf = p.classifierConfidence;
    const flag =
      conf === 'high' ? '✓' :
      conf === 'synthetic' ? '★' :
      conf === 'medium' ? '~' : '✗';
    const dur = p.durationMin !== null ? `${p.durationMin}m` : '—';
    console.log(
      `  ${flag} [${String(p.partOrder).padStart(2)}] ${p.partKey.padEnd(28)} ${dur.padEnd(4)} ` +
        `${(p.rawTitle ?? '(synthetic)').slice(0, 60)}`,
    );
  }
}

console.log(`\nFull JSON: ${outPath}`);
