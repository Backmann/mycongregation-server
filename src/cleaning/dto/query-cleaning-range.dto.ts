import { IsDateString } from 'class-validator';

export class QueryCleaningRangeDto {
  /** Inclusive lower bound (Monday). */
  @IsDateString()
  weekStart!: string;

  /** EXCLUSIVE upper bound — the same meaning every other range here gives it. */
  @IsDateString()
  weekEnd!: string;
}
