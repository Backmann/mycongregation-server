import { IsDateString, IsOptional } from 'class-validator';

export class QueryFieldServiceMeetingsDto {
  /** Monday (ISO) of the week to list. When omitted, all weeks are returned. */
  @IsOptional()
  @IsDateString()
  weekStart?: string;

  /**
   * EXCLUSIVE upper bound. Given together with weekStart it turns that field
   * from «this week» into «from this week», which is what a screen showing
   * several weeks needs. Omitted, nothing changes: one week exactly, as before.
   */
  @IsOptional()
  @IsDateString()
  weekEnd?: string;
}
