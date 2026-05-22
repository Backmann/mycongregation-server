import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { CleaningSlotType } from '../../common/enums/cleaning-slot-type.enum';

export class SetCleaningSlotDto {
  @IsDateString()
  weekStartDate!: string;

  @IsEnum(CleaningSlotType)
  slotType!: CleaningSlotType;

  /**
   * The assigned service group. Ignored (forced null) for the GENERAL slot.
   * Omit or send null together with a DELETE to clear a slot entirely.
   */
  @IsOptional()
  @IsUUID()
  serviceGroupId?: string | null;
}
