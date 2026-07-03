import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
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

  /**
   * Hall-plan window numbers to wash. Only meaningful for the THOROUGH slot
   * (forced null otherwise). Deduplicated and sorted server-side.
   */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(99, { each: true })
  windows?: number[] | null;
}
