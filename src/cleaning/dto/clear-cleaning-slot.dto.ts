import { IsDateString, IsEnum } from 'class-validator';
import { CleaningSlotType } from '../../common/enums/cleaning-slot-type.enum';

export class ClearCleaningSlotDto {
  @IsDateString()
  weekStartDate!: string;

  @IsEnum(CleaningSlotType)
  slotType!: CleaningSlotType;
}
