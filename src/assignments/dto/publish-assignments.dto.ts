import { IsBoolean, IsEnum, IsISO8601, IsOptional } from 'class-validator';
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
}
