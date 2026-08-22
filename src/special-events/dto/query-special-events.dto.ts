import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class QuerySpecialEventsDto {
  /** 'true' to include past events (default: only upcoming). */
  @IsOptional()
  @IsString()
  all?: string;

  /**
   * The earliest date worth returning, `YYYY-MM-DD`.
   *
   * For screens that need some of the past but not all of it: the local-needs
   * list must know about a circuit overseer's visit that moved a meeting, and
   * asked for EVERY event ever recorded to find out. A year back answers the
   * same question and does not grow for ever.
   */
  @IsOptional()
  @IsISO8601()
  since?: string;

  /** 'true' to include soft-deleted events. */
  @IsOptional()
  @IsString()
  includeRemoved?: string;
}
