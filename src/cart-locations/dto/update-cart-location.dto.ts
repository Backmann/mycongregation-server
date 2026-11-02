import {
  CART_LOCATION_KINDS,
  type CartLocationKind,
} from '../../entities/cart-location.entity';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateCartLocationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsIn(CART_LOCATION_KINDS)
  kind?: CartLocationKind;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  equipmentAt?: string;

  /** The town's permit holds until this day; null clears it. */
  @IsOptional()
  @IsDateString()
  permitUntil?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
