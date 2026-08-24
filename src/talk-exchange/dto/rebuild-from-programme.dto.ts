import { IsISO8601 } from 'class-validator';

/**
 * From which date to rebuild. Required rather than defaulted: rebuilding the
 * whole history is a different act from repairing a season, and the caller
 * should have to say which one he means.
 */
export class RebuildFromProgrammeDto {
  @IsISO8601()
  from!: string;
}
