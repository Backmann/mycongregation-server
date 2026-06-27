import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCartAssignmentDto {
  @IsOptional()
  @IsUUID()
  publisherId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  externalName?: string;
}
