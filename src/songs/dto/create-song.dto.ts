import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateSongDto {
  @IsInt()
  @Min(1)
  @Max(999)
  number!: number;

  @IsString()
  @Length(1, 300)
  title!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
