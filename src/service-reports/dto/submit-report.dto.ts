import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class SubmitReportDto {
  // Optional: when an elder/admin submits on behalf of another publisher,
  // this is the target publisher's id. If omitted, the report is for the
  // currently authenticated user's own publisher record. If supplied and
  // equal to the caller's own publisher id, the submission is still
  // treated as self (no on-behalf flag).
  @IsOptional()
  @IsUUID()
  publisherId?: string;

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
