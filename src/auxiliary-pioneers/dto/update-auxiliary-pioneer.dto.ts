import { IsISO8601, IsOptional, IsBoolean } from 'class-validator';
import { ArrayMaxSize, IsArray, Matches } from 'class-validator';

/**
 * Edit an auxiliary-pioneer period. The publisher is never changed here — to
 * reassign, delete and create a new record. Only the start/end months and the
 * until-cancelled flag can be updated.
 */
export class UpdateAuxiliaryPioneerDto {
  @IsOptional()
  @IsISO8601()
  startMonth?: string;

  @IsOptional()
  @IsISO8601()
  endMonth?: string;

  @IsOptional()
  @IsBoolean()
  untilCancelled?: boolean;

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
