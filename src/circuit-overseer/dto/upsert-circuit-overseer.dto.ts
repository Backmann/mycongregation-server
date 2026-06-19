import { IsOptional, IsString, Length } from 'class-validator';

export class UpsertCircuitOverseerDto {
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
}
