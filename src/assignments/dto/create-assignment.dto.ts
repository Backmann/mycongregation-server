import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { EventType } from '../../common/enums/event-type.enum';
import { AssignmentStatus } from '../../common/enums/assignment-status.enum';

export class CreateAssignmentDto {
  @IsDateString()
  weekStartDate!: string;

  @IsEnum(EventType)
  eventType!: EventType;

  @IsString()
  @Length(1, 64)
  partKey!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  partOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  partTitle?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  partDurationMin?: number;

  /**
   * Explicit null means "nobody" — on update that is how an assignment is
   * cleared, since the service writes the payload straight onto the record.
   *
   * class-validator's @IsOptional() has always let null past at runtime; only
   * the type said otherwise, so a test exercising real behaviour could not
   * compile. Nobody noticed because the gate does not type-check specs.
   */
  @IsOptional()
  @IsUUID()
  publisherId?: string | null;

  @IsOptional()
  @IsUUID()
  assistantPublisherId?: string | null;

  @IsOptional()
  @IsEnum(AssignmentStatus)
  status?: AssignmentStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  publicTalkId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  speakerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  speakerCongregation?: string;

  /**
   * A correction of a programme that has become the record (a week after
   * its meeting). Honoured only for an administrator or the coordinator of
   * the body of elders; anyone else is refused, the flag or not.
   */
  @IsOptional()
  @IsBoolean()
  retroactive?: boolean;
}
