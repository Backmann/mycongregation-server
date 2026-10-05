/**
 * A programme part as the import receives it, and the title it is stored
 * under.
 *
 * This is what remains of the server's own workbook parser. Until 12 June
 * 2026 the EPUB was uploaded and read here; since then the app reads it in
 * the browser and sends only the parts (`POST /mwb-import/apply`), and the
 * publication's file never reaches the server. The parser, the upload routes
 * and the separate Watchtower import went unused from that day and were
 * removed on 5 October — after the two corrections that had been written into
 * the unused code were moved to where the import really runs.
 *
 * Reading the publications is checked where it happens: the app's
 * `scripts/check-import-parsers.mjs` and `scripts/check-import-documents.mjs`.
 */

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
