import {
  IsOptional,
  IsUUID,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class AssignDutyDto {
  /** Publisher to assign; null/omitted clears the slot. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  publisherId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
