import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCartRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  withWhomNote?: string;
}
