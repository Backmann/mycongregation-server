import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Patch an existing service report (self-edit within window, or elder/admin).
 *
 * All fields are optional; only the fields provided are updated.
 * `reportMonth` is NOT editable.
 * Form-variant rules (servedThisMonth vs hoursReported) are enforced
 * on update against the publisher's pioneer status.
 */
export class UpdateReportDto {
  // For regular publishers (Publisher.pioneerType === NONE).
  @IsOptional()
  @IsBoolean()
  servedThisMonth?: boolean;

  // For pioneers (Publisher.pioneerType !== NONE).
  @IsOptional()
  @IsInt()
  @Min(0)
  hoursReported?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bibleStudies?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
