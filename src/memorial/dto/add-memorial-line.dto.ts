import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MEMORIAL_SECTION } from '../memorial-template';

export class AddMemorialLineDto {
  /** programme | emblems | duty */
  @IsIn(Object.values(MEMORIAL_SECTION))
  section!: string;

  /** What the sheet says: «Левый ряд», «Фойе», «Стоянка». */
  @IsString()
  @MaxLength(255)
  label!: string;

  /** Set only for the fixed programme parts; null for zones and duties. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  partKey?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
