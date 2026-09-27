import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

/** Where the circuit overseer stays — all the visit schedule may change. */
export class UpdateAccommodationDto {
  @IsOptional()
  @IsUUID()
  coAccommodationPublisherId?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  coAccommodationAddress?: string | null;
}
