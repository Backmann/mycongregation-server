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
} from 'class-validator';

export class UpdateSpecialEventDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  type?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  time?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  mapUrl?: string;

  @IsOptional()
  @IsString()
  programUrl?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  coFirstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  coLastName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  coWifeName?: string;

  @IsOptional()
  @IsIn(['overseer', 'substitute'])
  coRole?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  coAccommodationAddress?: string;

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
