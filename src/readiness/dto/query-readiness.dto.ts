import { IsDateString } from 'class-validator';

export class QueryReadinessDto {
  /** Inclusive lower bound, any date inside the first week. */
  @IsDateString()
  weekStart!: string;

  /** EXCLUSIVE upper bound — the same meaning the assignments and duties
   * endpoints give it. */
  @IsDateString()
  weekEnd!: string;
}
