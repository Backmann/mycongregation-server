import { IsString, MaxLength, MinLength } from 'class-validator';

export class RenamePlaceDto {
  /** What the congregation calls this place: «Стоянка», «Левый ряд». */
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  customLabel!: string;
}
