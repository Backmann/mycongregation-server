/**
 * Parses a JW Watchtower study EPUB into structured weekly programmes.
 *
 * Pure-functions module — no NestJS dependencies. Used by both the
 * WtImportService (HTTP upload flow) and scripts/parse-wt.ts (CLI inspection).
 *
 * Watchtower study editions contain ~5 study articles per issue, one per week.
 * Each article maps to one weekend meeting with 6 parts.
 */

import AdmZip from 'adm-zip';
import * as cheerio from 'cheerio';
import * as path from 'path';

// ---------- Types ----------

export interface ParsedWtPart {
  partKey: string;
  partOrder: number;
  partTitle: string | null;
  durationMin: number | null;
  synthetic?: boolean;
}

export interface ParsedWtWeek {
  fileName: string;
  weekStartDate: string;
  weekEndDate: string;
  articleTitle: string;
  openingSong: number | null;
  closingSong: number | null;
  parts: ParsedWtPart[];
}

export interface ParsedWtIssue {
  epubFile: string;
  year: number;
  weeks: ParsedWtWeek[];
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

/** Days between two YYYY-MM-DD dates (end - start). */
export function daysBetween(startISO: string, endISO: string): number {
  const start = new Date(startISO + 'T00:00:00Z').getTime();
  const end = new Date(endISO + 'T00:00:00Z').getTime();
  return Math.round((end - start) / 86_400_000);
}

export function parseDateRange(
  text: string,
): { start: string; end: string; year: number } | null {
  const normalized = text
    .replace(/[—–\u2014\u2013\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  // Cross-month: "29 ИЮНЯ - 5 ИЮЛЯ 2026"
  let m = normalized.match(
    /(\d+)\s+([А-Яа-яё]+)\s*-\s*(\d+)\s+([А-Яа-яё]+)\s+(\d{4})/u,
  );
  if (m) {
    const [, sd, sm, ed, em, yr] = m;
    const startMonth = MONTHS_RU[sm];
    const endMonth = MONTHS_RU[em];
    if (!startMonth || !endMonth) return null;
    const year = parseInt(yr, 10);
    const endYear = startMonth === 12 && endMonth === 1 ? year + 1 : year;
    return {
      start: formatISO(year, startMonth, parseInt(sd, 10)),
      end: formatISO(endYear, endMonth, parseInt(ed, 10)),
      year,
    };
  }

  // Same-month: "4-10 МАЯ 2026"
  m = normalized.match(/(\d+)\s*-\s*(\d+)\s+([А-Яа-яё]+)\s+(\d{4})/u);
  if (m) {
    const [, sd, ed, mn, yr] = m;
    const month = MONTHS_RU[mn];
    if (!month) return null;
    const year = parseInt(yr, 10);
    return {
      start: formatISO(year, month, parseInt(sd, 10)),
      end: formatISO(year, month, parseInt(ed, 10)),
      year,
    };
  }

  return null;
}

export function extractSongs(text: string): number[] {
  const matches = text.match(/ПЕСН[ЯИ]?\s+(\d+)/giu) ?? [];
  return matches
    .map((s) => parseInt(s.match(/\d+/)?.[0] ?? '0', 10))
    .filter((n) => n > 0);
}

// ---------- Per-article parser ----------

function parseStudyArticle(
  fileName: string,
  content: string,
): ParsedWtWeek | null {
  const $ = cheerio.load(content, { xmlMode: true });

  const headerText = $('header').text().replace(/\s+/g, ' ').trim();
  if (!headerText) return null;

  // Guard 1: the <header> must mention a song. Cover/TOC pages never do.
  if (!/ПЕСН[ЯИ]?\s+\d+/iu.test(headerText)) return null;

  const range = parseDateRange(headerText);
  if (!range) return null;

  // Guard 2: range must be at most a week (7 days). Cover page advertises the
  // whole issue ("4 МАЯ — 7 ИЮНЯ 2026") which is ~35 days.
  const span = daysBetween(range.start, range.end);
  if (span < 0 || span > 7) return null;

  const articleTitle = $('h1').first().text().replace(/\s+/g, ' ').trim();
  if (!articleTitle) return null;

  const bodyText = $('body').text();
  const songNumbers = extractSongs(bodyText);
  const openingSong = songNumbers[0] ?? null;
  const closingSong =
    songNumbers.length > 1 ? songNumbers[songNumbers.length - 1] : null;

  const parts: ParsedWtPart[] = [
    {
      partKey: 'weekend_chairman',
      partOrder: 1,
      partTitle: null,
      durationMin: null,
      synthetic: true,
    },
    {
      partKey: 'weekend_opening_prayer',
      partOrder: 2,
      partTitle: openingSong !== null ? `Песня ${openingSong} и молитва` : null,
      durationMin: 1,
    },
    {
      partKey: 'public_talk_speaker',
      partOrder: 3,
      partTitle: null,
      durationMin: 30,
      synthetic: true,
    },
    {
      partKey: 'watchtower_conductor',
      partOrder: 4,
      partTitle: articleTitle,
      durationMin: 60,
    },
    {
      partKey: 'watchtower_reader',
      partOrder: 5,
      partTitle: null,
      durationMin: 60,
    },
    {
      partKey: 'weekend_closing_prayer',
      partOrder: 6,
      partTitle: closingSong !== null ? `Песня ${closingSong} и молитва` : null,
      durationMin: 1,
    },
  ];

  return {
    fileName,
    weekStartDate: range.start,
    weekEndDate: range.end,
    articleTitle,
    openingSong,
    closingSong,
    parts,
  };
}

// ---------- Public API ----------

export function parseWtBuffer(
  buffer: Buffer,
  year?: number,
  fileName?: string,
): ParsedWtIssue {
  const resolvedYear = year ?? new Date().getFullYear();
  const baseName = fileName ? path.basename(fileName) : 'wt.epub';

  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  const articleEntries = entries.filter((e) => {
    if (e.isDirectory) return false;
    const base = path.basename(e.entryName);
    return /^\d+\.xhtml$/i.test(base);
  });

  const result: ParsedWtIssue = {
    epubFile: baseName,
    year: resolvedYear,
    weeks: [],
    errors: [],
  };

  for (const entry of articleEntries) {
    const content = entry.getData().toString('utf8');
    try {
      const week = parseStudyArticle(entry.entryName, content);
      if (week) result.weeks.push(week);
    } catch (err: any) {
      result.errors.push(`${entry.entryName}: ${err.message}`);
    }
  }

  result.weeks.sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));

  return result;
}
