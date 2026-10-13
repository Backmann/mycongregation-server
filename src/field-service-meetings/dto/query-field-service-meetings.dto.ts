import { IsDateString, IsIn, IsOptional } from 'class-validator';

export class QueryFieldServiceMeetingsDto {
  /**
   * «1» — include the drafts too. Honoured only for a reader who may plan;
   * for everybody else, and for every app that does not send it, the list is
   * the announced schedule alone.
   */
  @IsOptional()
  @IsIn(['0', '1'])
  drafts?: '0' | '1';

  /**
   * «1» — include the cancelled meetings, crossed out (13 October 2026). An
   * app that does not send it — every version before this one — would draw a
   * cancelled meeting as an ordinary one, so it is left out for them: to
   * them it is gone, as a deleted meeting always was.
   */
  @IsOptional()
  @IsIn(['0', '1'])
  cancelled?: '0' | '1';

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
