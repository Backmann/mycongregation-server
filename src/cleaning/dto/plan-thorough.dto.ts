import { IsDateString, IsISO8601, IsOptional } from 'class-validator';

export class PlanThoroughDto {
  /** Monday of the ISO week the thorough slot belongs to. */
  @IsDateString()
  weekStartDate!: string;

  /**
   * When the group plans to clean (ISO datetime), or null to clear the plan.
   * Must fall inside the given week.
   */
  @IsOptional()
  @IsISO8601()
  plannedAt?: string | null;
}
