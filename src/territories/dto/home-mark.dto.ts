import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  ValidateIf,
} from 'class-validator';

/**
 * The keepers' word on a building (15 November 2026): `home` true or false,
 * or null to take the mark back and let the rule decide. The point is
 * where the building is (its middle, as the app shows it).
 */
export class HomeMarkDto {
  @IsLongitude()
  lon!: number;

  @IsLatitude()
  lat!: number;

  @ValidateIf((_o, v) => v !== null)
  @IsBoolean()
  home!: boolean | null;
}
