/**
 * Parses a JW Meeting Workbook (MWB) EPUB into structured weekly programmes.
 *
 * Pure-functions module — no NestJS dependencies. Used by both the
 * MwbImportService (HTTP upload flow) and scripts/parse-mwb.ts (CLI inspection).
 */

import AdmZip from 'adm-zip';
import * as cheerio from 'cheerio';
import * as path from 'path';

// ---------- Types ----------

export interface ParsedPart {
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

export interface ParsedWeek {
  fileName: string;
  weekStartDate: string;
  weekEndDate: string;
  weekRangeText: string;
  biblePassage: string;
  parts: ParsedPart[];
}

export interface ParsedWorkbook {
  epubFile: string;
  year: number;
  weeks: ParsedWeek[];
  errors: string[];
}

// ---------- Russian month names ----------

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

// ---------- Helpers ----------

export function extractYearFromFilename(file: string): number {
  const m = path.basename(file).match(/(\d{4})\d{2}\.epub$/i);
  return m ? parseInt(m[1], 10) : new Date().getFullYear();
}

function formatISO(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseWeekRange(
  text: string,
  year: number,
): { start: string; end: string } | null {
  const normalized = text
    .replace(/[—–\u2014\u2013\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  let m = normalized.match(
    /^(\d+)\s+([А-Яа-яё]+)\s*-\s*(\d+)\s+([А-Яа-яё]+)$/u,
  );
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

export function extractDuration(text: string): {
  min: number | null;
  raw: string | null;
} {
  const m = text.match(/\(\s*(\d+)\s*мин/u);
  if (m) return { min: parseInt(m[1], 10), raw: m[0] };
  const m2 = text.match(/(\d+)\s*мин/u);
  if (m2) return { min: parseInt(m2[1], 10), raw: m2[0] };
  return { min: null, raw: null };
}

export function extractNumber(text: string): number | null {
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

// ---------- Classifier ----------

interface SectionCounters {
  treasures: number;
  apply_yourself: number;
  living_christians: number;
}

interface ClassifyResult {
  partKey: string;
  partOrder: number;
  confidence: ParsedPart['classifierConfidence'];
}

function classify(
  rawTitle: string,
  _rawNumber: number | null,
  section: string,
  durationMin: number | null,
  counters: SectionCounters,
): ClassifyResult {
  const lower = rawTitle.toLowerCase();

  if (section === 'intro') {
    if (lower.includes('молитва') || lower.includes('вступит')) {
      return {
        partKey: 'midweek_opening_prayer',
        partOrder: 2,
        confidence: 'high',
      };
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
    if (
      (lower.includes('изучение библии') &&
        (lower.includes('собрании') || lower.includes('собрание'))) ||
      (durationMin === 30 && !lower.includes('молитва'))
    ) {
      return { partKey: 'cbs_conductor', partOrder: 13, confidence: 'high' };
    }
    if (lower.includes('заключит') || lower.includes('молитва')) {
      return {
        partKey: 'midweek_closing_prayer',
        partOrder: 15,
        confidence: 'high',
      };
    }
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

// ---------- Per-file parser ----------

function parseWeeklyFile(
  fileName: string,
  content: string,
  year: number,
): ParsedWeek | null {
  const $ = cheerio.load(content, { xmlMode: true });

  const h1Text = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const range = parseWeekRange(h1Text, year);

  if (!range) return null;

  let biblePassage = '';
  $('h2').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (!isSectionH2(t) && !biblePassage) biblePassage = t;
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

      if (tag === 'h3') {
        if (/^Песн[яи]?\s*\d+\s*$/iu.test(text)) {
          if (
            currentSection === 'living_christians' &&
            !parts.some((p) => p.partKey === 'mid_song')
          ) {
            parts.push({
              rawTitle: text,
              rawNumber: null,
              rawSection: currentSection,
              durationMin: null,
              durationRawText: null,
              notes: [],
              partKey: 'mid_song',
              partOrder: 9,
              classifierConfidence: 'high',
            });
          }
          return;
        }

        const number = extractNumber(text);
        let { min: durationMin, raw: durationRawText } = extractDuration(text);

        if (durationMin === null) {
          $(el)
            .nextUntil('h3, h2')
            .each((_, n) => {
              if (durationMin !== null) return;
              const d = extractDuration($(n).text());
              if (d.min !== null) {
                durationMin = d.min;
                durationRawText = d.raw;
              }
            });
        }

        // Collect <p> elements within sibling containers (divs) after this h3,
        // until the next h2/h3. Strip leading "(N мин.)" duration marker since
        // duration is captured separately in part.durationMin.
        const notes: string[] = [];
        $(el)
          .nextUntil('h3, h2')
          .find('p')
          .slice(0, 3)
          .each((_, p) => {
            let nt = $(p).text().replace(/\s+/g, ' ').trim();
            if (!nt) return;
            nt = nt.replace(/^\(\s*\d+\s*мин\.?\s*\)\s*/u, '').trim();
            if (nt) {
              notes.push(nt.slice(0, 120));
            }
          });

        const cls = classify(
          text,
          number,
          currentSection,
          durationMin,
          counters,
        );

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

  // Synthetic chairman (always)
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

  // Synthetic CBS reader (only if conductor was detected)
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

  // Opening song (order 2): the meeting opens with a song, then the prayer.
  // Shift everything after the chairman down by one and insert the song row.
  // The opening song is chosen by the congregation (set via the song picker),
  // so it starts empty.
  for (const p of parts) {
    if (p.partOrder >= 2) p.partOrder += 1;
  }
  parts.push({
    rawTitle: null,
    rawNumber: null,
    rawSection: 'synthetic',
    durationMin: null,
    durationRawText: null,
    notes: [],
    partKey: 'midweek_opening_song',
    partOrder: 2,
    classifierConfidence: 'synthetic',
    synthetic: true,
  });
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

// ---------- Public API ----------

/**
 * Strips numeric prefix and trailing duration to get a clean title for storage,
 * then enriches with the first content note (scripture reference, talk content).
 *
 * Examples:
 * "5. Чтение Библии (4 мин.)" + notes=["Иса 60:1-22"]
 *    → "Чтение Библии: Иса 60:1-22"
 *
 * "1. Почувствуйте, как Иегова щедро вознаграждает" (no notes)
 *    → "Почувствуйте, как Иегова щедро вознаграждает"
 */
export function extractPartTitle(part: ParsedPart): string | null {
  if (part.synthetic) return null;
  if (!part.rawTitle) return null;
  let title = part.rawTitle.trim();
  title = title.replace(/^\d+\.\s*/, '');
  title = title.replace(/\s*\(\s*\d+\s*мин\.?\s*\)\s*$/u, '').trim();

  // Append first content note (scripture reference, talk content, etc.)
  if (part.notes && part.notes.length > 0 && part.notes[0]) {
    title = `${title}: ${part.notes[0]}`;
  }

  return title || null;
}

/**
 * Parse an MWB EPUB buffer.
 * @param buffer  raw EPUB file contents
 * @param year    year hint (extracted from filename if not given). Defaults to current year.
 * @param fileName optional, used for diagnostic output
 */
export function parseMwbBuffer(
  buffer: Buffer,
  year?: number,
  fileName?: string,
): ParsedWorkbook {
  const resolvedYear = year ?? new Date().getFullYear();
  const baseName = fileName ? path.basename(fileName) : 'mwb.epub';

  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  const weeklyEntries = entries.filter((e) => {
    if (e.isDirectory) return false;
    const base = path.basename(e.entryName);
    return /^\d+\.xhtml$/i.test(base);
  });

  const result: ParsedWorkbook = {
    epubFile: baseName,
    year: resolvedYear,
    weeks: [],
    errors: [],
  };

  for (const entry of weeklyEntries) {
    const content = entry.getData().toString('utf8');
    try {
      const week = parseWeeklyFile(entry.entryName, content, resolvedYear);
      if (week) result.weeks.push(week);
    } catch (err: any) {
      result.errors.push(`${entry.entryName}: ${err.message}`);
    }
  }

  result.weeks.sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));

  return result;
}
