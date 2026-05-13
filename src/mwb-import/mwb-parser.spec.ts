import {
  extractYearFromFilename,
  extractPartTitle,
  ParsedPart,
} from './mwb-parser';

/**
 * Test helper: build a ParsedPart with sensible defaults that can be
 * overridden case-by-case. Without this, every test would need to
 * spell out every field.
 */
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
