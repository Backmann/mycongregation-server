import {
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * Putting a topic into a week of the programme (28 October 2026). Three ways,
 * as the body of elders uses them:
 *   - instead of the «Местные потребности» part — `assignmentId` is that part;
 *   - instead of another «В жизни христианина» part — `assignmentId` is it;
 *   - as one more part — no `assignmentId`.
 */
export class PlaceLocalNeedsTopicDto {
  /** Any date in the week; snapped to its Monday. */
  @IsDateString()
  weekStartDate!: string;

  /** The part whose title the topic takes. Absent: a new part is added. */
  @IsOptional()
  @IsUUID()
  assignmentId?: string;

  /** Minutes of a new part. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  durationMin?: number;
}
