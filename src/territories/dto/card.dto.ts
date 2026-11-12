import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { TERRITORY_KINDS } from '../../entities/territory.entity';

/**
 * The territory's card (12 November 2026): what the territory servant may
 * correct by hand. The outline is not here — it has its own editor.
 */
export class EditTerritoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  number?: string;

  /** Empty or null clears it. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(120)
  locality?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(TERRITORY_KINDS)
  kind?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
