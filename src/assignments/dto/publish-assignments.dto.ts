import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { EventType } from '../../common/enums/event-type.enum';

/**
 * Bulk-publish input: flips every draft assignment of one meeting
 * (week + section) to published. The section guard reads eventType
 * from this body to authorize the caller for that section.
 */
export class PublishAssignmentsDto {
  @IsISO8601()
  weekStartDate!: string;

  @IsEnum(EventType)
  eventType!: EventType;

  /**
   * Whether to notify the congregation (push). Defaults to true to
   * preserve existing behaviour; pass false for a silent publish.
   */
  @IsOptional()
  @IsBoolean()
  notify?: boolean;

  /**
   * The places still empty, as the screen counted them when it asked «publish
   * anyway?» (R-16) — kept in the journal entry of the publish, nothing more.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  emptySeats?: number;
}
