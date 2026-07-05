import { IsEnum, IsISO8601, IsIn } from 'class-validator';
import { EventType } from '../../common/enums/event-type.enum';

/**
 * Swap or move the weekend public-talk slot contents between two weeks —
 * for when the speaker booked for a future week arrives today (or vice
 * versa). eventType is carried for AssignmentSectionGuard authorization and
 * must be 'weekend'.
 */
export class SwapPublicTalkDto {
  @IsEnum(EventType)
  eventType!: EventType;

  @IsISO8601()
  sourceWeekStartDate!: string;

  @IsISO8601()
  targetWeekStartDate!: string;

  /** 'swap' exchanges both weeks; 'move' fills target and clears source. */
  @IsIn(['swap', 'move'])
  mode!: 'swap' | 'move';
}
