import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class BootstrapDto {
  @IsString()
  @Length(1, 255)
  congregationName!: string;

  @IsString()
  @Length(2, 2)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @Matches(/^[A-Z]{2}$/, {
    message: 'country must be 2 uppercase letters (ISO 3166-1 alpha-2)',
  })
  country!: string;

  @IsString()
  @Length(2, 5)
  language!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;

  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
