import {
  extractYearFromFilename,
  extractPartTitle,
  parseWeekRange,
  extractDuration,
  extractNumber,
  ParsedPart,
} from './mwb-parser';

function makePart(overrides: Partial<ParsedPart> = {}): ParsedPart {
  return {
    rawTitle: null,
    rawNumber: null,
    rawSection: 'treasures',
    durationMin: null,
    durationRawText: null,
    notes: [],
    partKey: 'unknown',
    partOrder: 0,
    classifierConfidence: 'unknown',
    ...overrides,
  };
}

describe('mwb-parser', () => {
  describe('extractYearFromFilename', () => {
    it('extracts year from standard MWB filename', () => {
      expect(extractYearFromFilename('mwb_U_202605.epub')).toBe(2026);
    });

    it('extracts year from Watchtower filename', () => {
      expect(extractYearFromFilename('w_U_202603.epub')).toBe(2026);
    });

    it('extracts year from December issue', () => {
      expect(extractYearFromFilename('mwb_E_202512.epub')).toBe(2025);
    });

    it('handles uppercase .EPUB extension', () => {
      expect(extractYearFromFilename('mwb_U_202605.EPUB')).toBe(2026);
    });

    it('handles full path, not just basename', () => {
      expect(
        extractYearFromFilename('/home/user/Downloads/mwb_U_202605.epub'),
      ).toBe(2026);
    });

    it('falls back to current year when no pattern matches', () => {
      expect(extractYearFromFilename('random-name.epub')).toBe(
        new Date().getFullYear(),
      );
    });
  });

  describe('parseWeekRange', () => {
    it('parses same-month range', () => {
      expect(parseWeekRange('11-17 мая', 2026)).toEqual({
        start: '2026-05-11',
        end: '2026-05-17',
      });
    });

    it('parses cross-month range', () => {
      expect(parseWeekRange('29 июня - 5 июля', 2026)).toEqual({
        start: '2026-06-29',
        end: '2026-07-05',
      });
    });

    it('handles year crossover (Dec → Jan)', () => {
      expect(parseWeekRange('29 декабря - 4 января', 2025)).toEqual({
        start: '2025-12-29',
        end: '2026-01-04',
      });
    });

    it('normalizes em-dash to hyphen', () => {
      expect(parseWeekRange('11—17 мая', 2026)).toEqual({
        start: '2026-05-11',
        end: '2026-05-17',
      });
    });

    it('normalizes en-dash to hyphen', () => {
      expect(parseWeekRange('11–17 мая', 2026)).toEqual({
        start: '2026-05-11',
        end: '2026-05-17',
      });
    });

    it('returns null for unparseable text', () => {
      expect(parseWeekRange('not a date', 2026)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseWeekRange('', 2026)).toBeNull();
    });

    it('returns null for invalid month name', () => {
      expect(parseWeekRange('11-17 fakemonth', 2026)).toBeNull();
    });
  });

  describe('extractDuration', () => {
    it('extracts duration with parentheses', () => {
      const result = extractDuration('(4 мин.)');
      expect(result.min).toBe(4);
      expect(result.raw).toBe('(4 мин');
    });

    it('extracts two-digit duration', () => {
      expect(extractDuration('(10 мин.)').min).toBe(10);
    });

    it('extracts duration from text with prefix', () => {
      expect(extractDuration('5. Чтение (3 мин)').min).toBe(3);
    });

    it('extracts duration without parentheses (fallback)', () => {
      expect(extractDuration('Длительность 30 мин всего').min).toBe(30);
    });

    it('returns null for text without duration', () => {
      const result = extractDuration('просто текст без минут');
      expect(result.min).toBeNull();
      expect(result.raw).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractDuration('').min).toBeNull();
    });
  });

  describe('extractNumber', () => {
    it('extracts single-digit number', () => {
      expect(extractNumber('5. Чтение Библии')).toBe(5);
    });

    it('extracts two-digit number', () => {
      expect(extractNumber('15. CBS')).toBe(15);
    });

    it('handles leading whitespace', () => {
      expect(extractNumber('  3. With leading space')).toBe(3);
    });

    it('returns null when no number prefix', () => {
      expect(extractNumber('Без префикса')).toBeNull();
    });

    it('returns null without space after dot', () => {
      expect(extractNumber('5.NoSpaceAfter')).toBeNull();
    });

    it('returns null without dot', () => {
      expect(extractNumber('5 без точки')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractNumber('')).toBeNull();
    });
  });

  describe('extractPartTitle', () => {
    it('returns null for synthetic parts (chairman/CBS reader)', () => {
      const part = makePart({ synthetic: true, rawTitle: 'Should be ignored' });
      expect(extractPartTitle(part)).toBeNull();
    });

    it('returns null when rawTitle is null', () => {
      const part = makePart({ rawTitle: null });
      expect(extractPartTitle(part)).toBeNull();
    });

    it('strips numeric prefix like "5. "', () => {
      const part = makePart({ rawTitle: '5. Чтение Библии' });
      expect(extractPartTitle(part)).toBe('Чтение Библии');
    });

    it('strips trailing duration like "(4 мин.)"', () => {
      const part = makePart({ rawTitle: 'Чтение Библии (4 мин.)' });
      expect(extractPartTitle(part)).toBe('Чтение Библии');
    });

    it('strips both numeric prefix and trailing duration', () => {
      const part = makePart({ rawTitle: '5. Чтение Библии (4 мин.)' });
      expect(extractPartTitle(part)).toBe('Чтение Библии');
    });

    it('appends first content note to title (e.g. scripture reference)', () => {
      const part = makePart({
        rawTitle: '5. Чтение Библии (4 мин.)',
        notes: ['Иса 60:1-22'],
      });
      expect(extractPartTitle(part)).toBe('Чтение Библии: Иса 60:1-22');
    });

    it('uses only the first note even when multiple are present', () => {
      const part = makePart({
        rawTitle: '4. Духовные жемчужины',
        notes: [
          'Иса 58:1, 2 — Почему пророк говорит?',
          'Иса 58:3, 4 — Какой пост приятен?',
          'Что в чтении Библии на этой неделе поучительно?',
        ],
      });
      expect(extractPartTitle(part)).toBe(
        'Духовные жемчужины: Иса 58:1, 2 — Почему пророк говорит?',
      );
    });

    it('does not enrich when notes array is empty', () => {
      const part = makePart({
        rawTitle: '5. Чтение Библии (4 мин.)',
        notes: [],
      });
      expect(extractPartTitle(part)).toBe('Чтение Библии');
    });

    it('does not enrich when notes[0] is an empty string', () => {
      const part = makePart({
        rawTitle: '5. Чтение Библии',
        notes: [''],
      });
      expect(extractPartTitle(part)).toBe('Чтение Библии');
    });

    it('preserves complex titles without prefix or duration', () => {
      const part = makePart({
        rawTitle: 'Песня 21 и молитва | Вступительные слова',
      });
      expect(extractPartTitle(part)).toBe(
        'Песня 21 и молитва | Вступительные слова',
      );
    });
  });
});
