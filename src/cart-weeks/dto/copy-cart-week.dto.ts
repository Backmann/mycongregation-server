import { IsDateString, IsOptional } from 'class-validator';

/** «Повторить прошлую неделю»: the same shifts, nobody on them. */
export class CopyCartWeekDto {
  @IsDateString()
  weekStartDate!: string;

  /** The week to repeat; the nearest earlier week with shifts when left out. */
  @IsOptional()
  @IsDateString()
  fromWeekStartDate?: string;
}
