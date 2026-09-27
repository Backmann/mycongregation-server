import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class UpdateSpecialEventDto {
  // Left out is fine; sent as null is not — every event has a title and a
  // date. (IsOptional would let a null through and blank the row.)
  @ValidateIf((o: UpdateSpecialEventDto) => o.title !== undefined)
  @IsString()
  @Length(1, 255)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  type?: string | null;

  @ValidateIf((o: UpdateSpecialEventDto) => o.date !== undefined)
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  time?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 5)
  timeEnd?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsString()
  mapUrl?: string | null;

  @IsOptional()
  @IsString()
  programUrl?: string | null;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  coFirstName?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  coLastName?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  coWifeName?: string | null;

  @IsOptional()
  @IsIn(['overseer', 'substitute'])
  coRole?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  coAccommodationAddress?: string | null;

  @IsOptional()
  @IsUUID()
  coAccommodationPublisherId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  coMidweekDow?: number;

  @IsOptional()
  @IsBoolean()
  replacesMeeting?: boolean;
}
