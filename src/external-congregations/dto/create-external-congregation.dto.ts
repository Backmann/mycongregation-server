import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateExternalCongregationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
