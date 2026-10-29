import {
  IsUUID,
  IsISO8601,
  IsOptional,
  IsBoolean,
  IsString,
  MaxLength,
} from 'class-validator';
import { ArrayMaxSize, IsArray, Matches } from 'class-validator';

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

  /**
   * The months («YYYY-MM») in which the person takes 15 hours — each must
   * allow it. Left out: chosen for him as before (every month that allows 15).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(120)
  @Matches(/^\d{4}-\d{2}$/, { each: true })
  reducedMonths?: string[];
}
