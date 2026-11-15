/**
 * The cadastre's words, as they come in ALKIS NW (14 November 2026), and
 * what they mean for us — for the tests of officialUse() and of the
 * database's official_use(), which must agree.
 */
export const OFFICIAL_WORDS: [string, 'home' | 'not' | 'unsure'][] = [
  ['Wohngebäude', 'home'],
  ['Gemischt genutztes Gebäude mit Wohnen', 'home'],
  ['Wohn- und Geschäftsgebäude', 'home'],
  ['Land- und forstwirtschaftliches Wohngebäude', 'home'],
  ['Bauernhaus', 'home'],
  ['Gebäude für Wirtschaft oder Gewerbe', 'not'],
  ['Gebäude für Land- und Forstwirtschaft', 'not'],
  ['Gebäude zum Parken', 'not'],
  ['Gebäude zur Freizeitgestaltung', 'not'],
  ['Allgemein bildende Schule', 'not'],
  ['Kirche', 'not'],
  ['Sonstiges', 'unsure'],
  ['Nach Quellenlage nicht zu spezifizieren', 'unsure'],
  ['Gebäude für soziale Zwecke', 'unsure'],
  ['Heilanstalt, Pflegeanstalt, Pflegestation', 'unsure'],
  ['Seniorenheim', 'unsure'],
  ['Gebäude für Erholungszwecke', 'unsure'],
];
