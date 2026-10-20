import { IsOptional, IsString, MaxLength } from 'class-validator';

/** A stage screen's name and menu digits, as an administrator changes them. */
export class UpdateStageDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  stagePin?: string;
}
