import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * Marking a topic as used.
 *
 * Both fields are optional and mean different things when absent:
 *   - no `week` — the congregation's current week, decided by the SERVER. The
 *     client used to compute it from the device clock, which is a different
 *     week for anyone whose phone is set to another timezone late on a Sunday.
 *   - no `assignmentId` — the week was ticked by hand rather than placed from
 *     the programme, so there is no part to point back at.
 */
export class MarkUsedLocalNeedsTopicDto {
  /** Any date in the week; the server snaps it to that week's Monday. */
  @IsOptional()
  @IsDateString()
  week?: string;

  /** The meeting part this topic filled, when placed from the schedule. */
  @IsOptional()
  @IsUUID()
  assignmentId?: string;
}
