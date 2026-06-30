import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCongregationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  assignmentAutomationEnabled?: boolean;
}
