import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CreateCircuitOverseerDto {
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @IsString()
  @Length(1, 100)
  lastName!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  wifeName?: string | null;

  @IsOptional()
  @IsIn(['overseer', 'substitute'])
  role?: 'overseer' | 'substitute';

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateCircuitOverseerDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  wifeName?: string | null;

  @IsOptional()
  @IsIn(['overseer', 'substitute'])
  role?: 'overseer' | 'substitute';

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
