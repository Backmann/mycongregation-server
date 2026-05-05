/**
 * Parse a JW Meeting Workbook EPUB into structured + classified JSON.
 *
 * Usage:
 *   npx ts-node scripts/parse-mwb.ts /path/to/mwb_X_YYYYMM.epub
 *
 * Outputs:
 *   - <tmpdir>/mwb-parsed.json — full structured data (raw + classified)
 *   - terminal: per-week summary with classification diagnostics
 *
 * Each weekly XHTML is walked in document order. We track the current
 * section (treasures / apply_yourself / living_christians) by h2 transitions
 * and classify each h3 into a partKey using section + text + position.
 *
 * Two synthetic parts are added per week (not present as h3 in MWB):
 *   - midweek_chairman (order 1) — covers the whole meeting
 *   - cbs_reader (order 14) — implicit second role for CBS
 */

import AdmZip from 'adm-zip';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const epubPath = process.argv[2];

if (!epubPath) {
  console.error('Usage: ts-node scripts/parse-mwb.ts <path-to-epub>');
  process.exit(1);
}

if (!fs.existsSync(epubPath)) {
  console.error(`File not found: ${epubPath}`);
  process.exit(1);
}

// ---- Russian month names → numbers ----
const MONTHS_RU: Record<string, number> = {};
const monthList = [
  ['январь', 'января'],
  ['февраль', 'февраля'],
  ['март', 'марта'],
  ['апрель', 'апреля'],
  ['май', 'мая'],
  ['июнь', 'июня'],
  ['июль', 'июля'],
  ['август', 'августа'],
  ['сентябрь', 'сентября'],
  ['октябрь', 'октября'],
  ['ноябрь', 'ноября'],
  ['декабрь', 'декабря'],
];
monthList.forEach((forms, i) => {
  forms.forEach((f) => {
    [f, f.toLowerCase(), f.toUpperCase()].forEach((variant) => {
      MONTHS_RU[variant] = i + 1;
    });
  });
});

// ---- Types ----

interface ParsedPart {
  rawTitle: string | null;
  rawNumber: number | null;
  rawSection: string;
  durationMin: number | null;
  durationRawText: string | null;
  notes: string[];
  partKey: string;
  partOrder: number;
  classifierConfidence: 'high' | 'medium' | 'low' | 'synthetic' | 'unknown';
  synthetic?: boolean;
}

interface ParsedWeek {
  fileName: string;
  weekStartDate: string;
  weekEndDate: string;
  weekRangeText: string;
  biblePassage: string;
  parts: ParsedPart[];
}

interface ParsedWorkbook {
  epubFile: string;
  year: number;
  weeks: ParsedWeek[];
  errors: string[];
}

// ---- Utilities ----

function extractYearFromFilename(file: string): number {
  const m = path.basename(file).match(/(\d{4})\d{2}\.epub$/i);
  return m ? parseInt(m[1], 10) : new Date().getFullYear();
}

function formatISO(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseWeekRange(text: string, year: number): { start: string; end: string } | null {
  const normalized = text
    .replace(/[—–\u2014\u2013\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  // Cross-month: "29 ИЮНЯ - 5 ИЮЛЯ"
  let m = normalized.match(/^(\d+)\s+([А-Яа-яё]+)\s*-\s*(\d+)\s+([А-Яа-яё]+)$/u);
  if (m) {
    const [, sd, sm, ed, em] = m;
    const startMonth = MONTHS_RU[sm];
    const endMonth = MONTHS_RU[em];
    if (!startMonth || !endMonth) return null;
    const endYear = startMonth === 12 && endMonth === 1 ? year + 1 : year;
    return {
      start: formatISO(year, startMonth, parseInt(sd, 10)),
      end: formatISO(endYear, endMonth, parseInt(ed, 10)),
    };
  }

  // Same-month: "4-10 МАЯ"
  m = normalized.match(/^(\d+)\s*-\s*(\d+)\s+([А-Яа-яё]+)$/u);
  if (m) {
    const [, sd, ed, mn] = m;
    const month = MONTHS_RU[mn];
    if (!month) return null;
    return {
      start: formatISO(year, month, parseInt(sd, 10)),
      end: formatISO(year, month, parseInt(ed, 10)),
    };
  }

  return null;
}

function extractDuration(text: string): { min: number | null; raw: string | null } {
  const m = text.match(/\(\s*(\d+)\s*мин/u);
  if (m) return { min: parseInt(m[1], 10), raw: m[0] };
  const m2 = text.match(/(\d+)\s*мин/u);
  if (m2) return { min: parseInt(m2[1], 10), raw: m2[0] };
  return { min: null, raw: null };
}

function extractNumber(text: string): number | null {
  const m = text.match(/^\s*(\d+)\.\s+/);
  return m ? parseInt(m[1], 10) : null;
}

function isSectionH2(text: string): boolean {
  const u = text.toUpperCase();
  return (
    u.includes('СОКРОВИЩА') ||
    u.includes('ОТТАЧИВАЕМ') ||
    u.includes('НАВЫКИ') ||
    u.includes('ХРИСТИАНСКАЯ')
  );
}

function detectSection(h2Text: string): string {
  const u = h2Text.toUpperCase();
  if (u.includes('СОКРОВИЩА')) return 'treasures';
  if (u.includes('ОТТАЧИВАЕМ') || u.includes('НАВЫКИ')) return 'apply_yourself';
  if (u.includes('ХРИСТИАНСКАЯ')) return 'living_christians';
  return 'intro';
}

// ---- Classifier ----

interface ClassifyResult {
  partKey: string;
  partOrder: number;
  confidence: ParsedPart['classifierConfidence'];
}

interface SectionCounters {
  treasures: number;
  apply_yourself: number;
  living_christians: number;
}

function classify(
  rawTitle: string,
  rawNumber: number | null,
  section: string,
  durationMin: number | null,
  counters: SectionCounters,
): ClassifyResult {
  const lower = rawTitle.toLowerCase();

  if (section === 'intro') {
    if (lower.includes('молитва') || lower.includes('вступит')) {
      return { partKey: 'midweek_opening_prayer', partOrder: 2, confidence: 'high' };
    }
    return { partKey: 'unknown', partOrder: 0, confidence: 'unknown' };
  }

  if (section === 'treasures') {
    const pos = counters.treasures++;
    if (lower.includes('духовные жемчужины')) {
      return { partKey: 'spiritual_gems', partOrder: 4, confidence: 'high' };
    }
    if (lower.includes('чтение библии')) {
      return { partKey: 'bible_reading', partOrder: 5, confidence: 'high' };
    }
    if (pos === 0) {
      return { partKey: 'treasures_talk', partOrder: 3, confidence: 'high' };
    }
    if (pos === 1) {
      return { partKey: 'spiritual_gems', partOrder: 4, confidence: 'medium' };
    }
    if (pos === 2) {
      return { partKey: 'bible_reading', partOrder: 5, confidence: 'medium' };
    }
    return { partKey: 'unknown', partOrder: 0, confidence: 'unknown' };
  }

  if (section === 'apply_yourself') {
    const pos = counters.apply_yourself++;
    if (pos >= 0 && pos < 4) {
      return {
        partKey: `apply_yourself_${pos + 1}`,
        partOrder: 6 + pos,
        confidence: 'high',
      };
    }
    return { partKey: 'unknown', partOrder: 0, confidence: 'unknown' };
  }

  if (section === 'living_christians') {
    // CBS detection (text wins)
    if (
      (lower.includes('изучение библии') &&
        (lower.includes('собрании') || lower.includes('собрание'))) ||
      (durationMin === 30 && !lower.includes('молитва'))
    ) {
      return { partKey: 'cbs_conductor', partOrder: 13, confidence: 'high' };
    }
    // Closing prayer detection
    if (lower.includes('заключит') || lower.includes('молитва')) {
      return { partKey: 'midweek_closing_prayer', partOrder: 15, confidence: 'high' };
    }
    // Otherwise sequential LC parts
    const pos = counters.living_christians++;
    if (pos >= 0 && pos < 3) {
      return {
        partKey: `living_christians_${pos + 1}`,
        partOrder: 10 + pos,
        confidence: 'high',
      };
    }
    return { partKey: 'unknown', partOrder: 0, confidence: 'unknown' };
  }

  return { partKey: 'unknown', partOrder: 0, confidence: 'unknown' };
}

// ---- Per-file parser ----

function parseWeeklyFile(
  fileName: string,
  content: string,
  year: number,
): ParsedWeek | null {
  const $ = cheerio.load(content, { xmlMode: true });

  const h1Text = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const range = parseWeekRange(h1Text, year);

  // Skip pages whose h1 isn't a week range (cover, title page, TOC, etc)
  if (!range) return null;

  let biblePassage = '';
  $('h2').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (!isSectionH2(t) && !biblePassage) {
      biblePassage = t;
    }
  });

  const parts: ParsedPart[] = [];
  let currentSection = 'intro';
  const counters: SectionCounters = {
    treasures: 0,
    apply_yourself: 0,
    living_christians: 0,
  };

  $('body')
    .find('h2, h3')
    .each((_, el) => {
      const tag = (el as any).tagName ?? (el as any).name;
      const text = $(el).text().replace(/\s+/g, ' ').trim();

      if (tag === 'h2') {
        if (isSectionH2(text)) currentSection = detectSection(text);
        return;
      }

      // h3
      if (tag === 'h3') {
        // Skip pure-song lines like "Песня 100"
        if (/^Песн[яи]?\s*\d+\s*$/iu.test(text)) return;

        const number = extractNumber(text);
        let { min: durationMin, raw: durationRawText } = extractDuration(text);

        if (durationMin === null) {
          const next = $(el).nextUntil('h3, h2');
          next.each((_, n) => {
            if (durationMin !== null) return;
            const nt = $(n).text();
            const d = extractDuration(nt);
            if (d.min !== null) {
              durationMin = d.min;
              durationRawText = d.raw;
            }
          });
        }

        const notes: string[] = [];
        $(el)
          .nextUntil('h3, h2', 'p')
          .slice(0, 3)
          .each((_, p) => {
            const nt = $(p).text().replace(/\s+/g, ' ').trim();
            if (nt && !/^\(\s*\d+\s*мин/u.test(nt)) {
              notes.push(nt.slice(0, 120));
            }
          });

        const cls = classify(text, number, currentSection, durationMin, counters);

        parts.push({
          rawTitle: text,
          rawNumber: number,
          rawSection: currentSection,
          durationMin,
          durationRawText,
          notes,
          partKey: cls.partKey,
          partOrder: cls.partOrder,
          classifierConfidence: cls.confidence,
        });
      }
    });

  // ---- Add synthetic parts ----

  // 1. midweek_chairman (always)
  parts.unshift({
    rawTitle: null,
    rawNumber: null,
    rawSection: 'synthetic',
    durationMin: null,
    durationRawText: null,
    notes: [],
    partKey: 'midweek_chairman',
    partOrder: 1,
    classifierConfidence: 'synthetic',
    synthetic: true,
  });

  // 2. cbs_reader (only if cbs_conductor was detected)
  const hasCbs = parts.some((p) => p.partKey === 'cbs_conductor');
  if (hasCbs) {
    parts.push({
      rawTitle: null,
      rawNumber: null,
      rawSection: 'synthetic',
      durationMin: null,
      durationRawText: null,
      notes: [],
      partKey: 'cbs_reader',
      partOrder: 14,
      classifierConfidence: 'synthetic',
      synthetic: true,
    });
  }

  // Sort by partOrder for predictable output
  parts.sort((a, b) => a.partOrder - b.partOrder);

  return {
    fileName,
    weekStartDate: range.start,
    weekEndDate: range.end,
    weekRangeText: h1Text,
    biblePassage,
    parts,
  };
}

// ---- Main ----

const epubBase = path.basename(epubPath);
const year = extractYearFromFilename(epubPath);

console.log(`\n=== Parsing ${epubBase} (year=${year}) ===\n`);

const zip = new AdmZip(epubPath);
const entries = zip.getEntries();

const weeklyEntries = entries.filter((e) => {
  if (e.isDirectory) return false;
  const base = path.basename(e.entryName);
  return /^\d+\.xhtml$/i.test(base);
});

console.log(`Found ${weeklyEntries.length} numeric XHTML files (some may not be weekly schedules)\n`);

const result: ParsedWorkbook = {
  epubFile: epubBase,
  year,
  weeks: [],
  errors: [],
};

for (const entry of weeklyEntries) {
  const content = entry.getData().toString('utf8');
  try {
    const week = parseWeeklyFile(entry.entryName, content, year);
    if (week) result.weeks.push(week);
    else
      console.log(
        `  skipped: ${entry.entryName} (not a weekly schedule — no parseable date range)`,
      );
  } catch (err: any) {
    result.errors.push(`${entry.entryName}: ${err.message}`);
  }
}

result.weeks.sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));

const outPath = path.join(os.tmpdir(), 'mwb-parsed.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

console.log('\n=== Per-week summary ===\n');
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

// Show first week in detail
if (result.weeks.length > 0) {
  const w = result.weeks[0];
  console.log(`\n=== Week 1 detailed parts ===\n`);
  for (const p of w.parts) {
    const conf = p.classifierConfidence;
    const flag = conf === 'high' ? '✓' : conf === 'synthetic' ? '★' : conf === 'medium' ? '~' : '✗';
    const dur = p.durationMin !== null ? `${p.durationMin}m` : '—';
    console.log(
      `  ${flag} [${String(p.partOrder).padStart(2)}] ${p.partKey.padEnd(28)} ${dur.padEnd(4)} ` +
        `${(p.rawTitle ?? '(synthetic)').slice(0, 60)}`,
    );
  }
}

console.log(`\nFull JSON: ${outPath}`);
console.log(`Inspect: jq '.weeks[0]' "${outPath}"`);
console.log(`All weeks summary: jq '.weeks[] | {start: .weekStartDate, parts: (.parts | length), unknowns: ([.parts[] | select(.partKey == "unknown")] | length)}' "${outPath}"\n`);
