import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Stop an auxiliary-pioneer period. The endMonth defaults to the current month
 * (the person served through the current month, then stops).
 */
export class StopAuxiliaryPioneerDto {
  @IsOptional()
  @IsISO8601()
  endMonth?: string;
}
