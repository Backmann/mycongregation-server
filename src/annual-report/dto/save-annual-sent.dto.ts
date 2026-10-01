import { IsInt, IsISO8601, IsObject, Max, Min } from 'class-validator';

/** «This is what I sent to the branch» — the S-10 as filed. */
export class SaveAnnualSentDto {
  /** The service year by its first calendar year: 2025 for 2025/26. */
  @IsInt()
  @Min(2000)
  @Max(2100)
  startYear!: number;

  /** The day it went to the branch. */
  @IsISO8601({ strict: true })
  sentOn!: string;

  /**
   * The numbers as they stand on the form: active, becameInactive,
   * reactivated, deaf, blind, imprisoned, midweekAverage, weekendAverage.
   * Checked one by one in the service.
   */
  @IsObject()
  figures!: Record<string, number | null>;
}
