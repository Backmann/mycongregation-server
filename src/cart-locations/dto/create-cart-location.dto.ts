import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCartLocationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsIn(['cart', 'stand'])
  kind?: 'cart' | 'stand';

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
