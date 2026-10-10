import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  CONDUCTOR_RULES,
  type ConductorRule,
} from '../../entities/field-service-template-slot.entity';

export class SuggestConductorDto {
  /** The day of the meeting: availability and turn are counted from it. */
  @IsDateString()
  date!: string;

  /** Whose meeting; with `group_overseer` its own men come first. */
  @IsOptional()
  @IsUUID()
  serviceGroupId?: string;

  @IsOptional()
  @IsIn(CONDUCTOR_RULES)
  conductorRule?: ConductorRule;

  /** The meeting being edited: its own conductor is not «busy» with it. */
  @IsOptional()
  @IsUUID()
  excludeMeetingId?: string;
}
