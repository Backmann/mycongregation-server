export interface WeekImportSummary {
  weekStartDate: string;
  weekEndDate: string;
  biblePassage: string;
  created: number;
  updated: number;
  skipped: number;
}

export interface ImportResultDto {
  epubFile: string;
  year: number;
  weeksImported: number;
  partsCreated: number;
  partsUpdated: number;
  partsSkipped: number;
  unclassifiedParts: number;
  weeks: WeekImportSummary[];
  errors: string[];
  warnings: string[];
}
