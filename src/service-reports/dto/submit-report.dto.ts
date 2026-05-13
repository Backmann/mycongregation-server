import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class SubmitReportDto {
  // Accepts "YYYY-MM" or "YYYY-MM-DD"; server normalizes to first of month.
  @Matches(/^\d{4}-\d{2}(-\d{2})?$/, {
    message: 'reportMonth must be in YYYY-MM or YYYY-MM-DD format',
  })
  reportMonth!: string;

  // For regular publishers (Publisher.pioneerType === NONE).
  // Required for regular publishers; must be omitted for pioneers.
  @IsOptional()
  @IsBoolean()
  servedThisMonth?: boolean;

  // For pioneers (Publisher.pioneerType !== NONE).
  // Required for pioneers; must be omitted for regular publishers.
  @IsOptional()
  @IsInt()
  @Min(0)
  hoursReported?: number;

  @IsInt()
  @Min(0)
  bibleStudies!: number;

  // TODO: encrypt at rest (see future data-protection.md).
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
