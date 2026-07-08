import {
  IsUUID,
  IsISO8601,
  IsOptional,
  IsBoolean,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateAuxiliaryPioneerDto {
  @IsUUID()
  publisherId!: string;

  /** First month of service — any date in the month (normalized to YYYY-MM-01). */
  @IsISO8601()
  startMonth!: string;

  /** Last month (inclusive); omit when untilCancelled is true. */
  @IsOptional()
  @IsISO8601()
  endMonth?: string;

  /** Serve indefinitely until stopped. When true, endMonth is ignored. */
  @IsOptional()
  @IsBoolean()
  untilCancelled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
