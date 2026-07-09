import { IsISO8601, IsOptional, IsBoolean } from 'class-validator';

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
}
