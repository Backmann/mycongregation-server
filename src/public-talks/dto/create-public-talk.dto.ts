import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreatePublicTalkDto {
  @IsInt()
  @Min(1)
  @Max(999)
  number!: number;

  @IsString()
  @Length(3, 500)
  title!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
