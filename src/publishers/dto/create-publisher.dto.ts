import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Gender } from '../../common/enums/gender.enum';
import { PublisherAppointment } from '../../common/enums/publisher-appointment.enum';
import { PioneerType } from '../../common/enums/pioneer-type.enum';

export class CreatePublisherDto {
  // ---- Personal ----
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  middleName?: string;

  @IsString()
  @Length(1, 100)
  lastName!: string;

  @IsEnum(Gender)
  gender!: Gender;

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null ? undefined : value,
  )
  @IsDateString()
  birthDate?: string;

  // ---- Contacts ----
  @IsOptional()
  @IsString()
  @MaxLength(32)
  mobilePhone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  // ---- Relations ----
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  serviceGroupId?: string;

  // ---- Status flags ----
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isRegular?: boolean;

  // ---- Spirituality ----
  @IsOptional()
  @IsEnum(PublisherAppointment)
  appointment?: PublisherAppointment;

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null ? undefined : value,
  )
  @IsDateString()
  baptismDate?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null ? undefined : value,
  )
  @IsDateString()
  ministryStartDate?: string;

  @IsOptional()
  @IsEnum(PioneerType)
  pioneerType?: PioneerType;

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null ? undefined : value,
  )
  @IsDateString()
  pioneerSince?: string;

  @IsOptional()
  @IsBoolean()
  isAnointed?: boolean;

  @IsOptional()
  @IsBoolean()
  hasKingdomHallKey?: boolean;

  @IsOptional()
  @IsBoolean()
  printedWatchtower?: boolean;

  @IsOptional()
  @IsBoolean()
  printedWorkbook?: boolean;

  @IsOptional()
  @IsBoolean()
  sendsReportDirectly?: boolean;

  @IsOptional()
  @IsString()
  spiritualNotes?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // ---- Capabilities ----
  @IsOptional()
  @IsObject()
  capabilities?: Record<string, boolean>;

  /** Public talk outline numbers this brother gives (outgoing speaker). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(300, { each: true })
  publicTalkNumbers?: number[];
}
