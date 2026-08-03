import {
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreatePioneerSchoolDto {
  @IsString()
  @MaxLength(160)
  title!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  hallName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  hallAddress?: string | null;

  @IsOptional()
  @Matches(TIME, { message: 'startTime must be HH:mm' })
  startTime?: string | null;

  @IsOptional()
  @Matches(TIME, { message: 'endTime must be HH:mm' })
  endTime?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  microphoneSlots?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}

export class UpdatePioneerSchoolDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  hallName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  hallAddress?: string | null;

  @IsOptional()
  @Matches(TIME, { message: 'startTime must be HH:mm' })
  startTime?: string | null;

  @IsOptional()
  @Matches(TIME, { message: 'endTime must be HH:mm' })
  endTime?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  microphoneSlots?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}

export class UpdatePioneerSchoolDayDto {
  @IsOptional()
  @Matches(TIME, { message: 'startTime must be HH:mm' })
  startTime?: string | null;

  @IsOptional()
  @Matches(TIME, { message: 'endTime must be HH:mm' })
  endTime?: string | null;
}

export class AssignPioneerSchoolDutyDto {
  /** null clears the slot. */
  @IsOptional()
  @IsUUID()
  helperId?: string | null;
}

export class CreatePioneerSchoolDutyDto {
  @IsUUID()
  dayId!: string;

  @IsString()
  @MaxLength(120)
  customLabel!: string;

  @IsOptional()
  @IsUUID()
  helperId?: string | null;
}

export class CreatePioneerSchoolHelperDto {
  @IsString()
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MaxLength(80)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  congregationName?: string | null;

  @IsOptional()
  @IsUUID()
  publisherId?: string | null;
}

export class UpdatePioneerSchoolHelperDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  congregationName?: string | null;

  @IsOptional()
  @IsUUID()
  publisherId?: string | null;
}

/** Unused today, kept out on purpose — see the service. */
export class ReservedDto {
  @IsOptional()
  @IsArray()
  reserved?: string[];
}
