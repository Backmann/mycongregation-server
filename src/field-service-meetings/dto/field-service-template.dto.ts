import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CONDUCTOR_RULES,
  type ConductorRule,
} from '../../entities/field-service-template-slot.entity';
import {
  PREPARE_LEADS,
  UNPUBLISHED_POLICIES,
  type PrepareLead,
  type UnpublishedPolicy,
} from '../../entities/field-service-settings.entity';

/**
 * One slot, in either shape.
 *
 * The OLD shape (`ordinal` + `address`) is what every app before October 2026
 * sends and is still accepted as it was: one ordinal, a general meeting at
 * that address, nobody picked. The NEW shape says which occurrences
 * (`ordinals` and/or `lastOnly`), whose meeting (`serviceGroupId`), where
 * (`address`, or null for the group's own place) and who conducts
 * (`conductorRule`). A slot must say at least one occurrence, and a general
 * meeting must say where — both checked in the service, in words.
 */
export class TemplateSlotDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  ordinal?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(5, { each: true })
  ordinals?: number[];

  @IsOptional()
  @IsBoolean()
  lastOnly?: boolean;

  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be "HH:MM"',
  })
  startTime!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  address?: string | null;

  @IsOptional()
  @IsUUID()
  serviceGroupId?: string | null;

  @IsOptional()
  @IsIn(CONDUCTOR_RULES)
  conductorRule?: ConductorRule;
}

export class ReplaceFieldServiceTemplateDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => TemplateSlotDto)
  slots!: TemplateSlotDto[];
}

export class GenerateFieldServiceDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  startYear!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  startMonth!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  months!: number;
}

/** One month, by the meetings' own dates. */
export class FieldServiceMonthDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}

export class PrepareFieldServiceMonthDto extends FieldServiceMonthDto {
  /** Leave every conductor empty, whatever the slots say. Default: pick. */
  @IsOptional()
  @IsBoolean()
  pickConductors?: boolean;
}

/** Every field optional: a window that sets one switch sends one. */
export class UpdateFieldServiceSettingsDto {
  @IsOptional()
  @IsBoolean()
  skipAssemblies?: boolean;

  @IsOptional()
  @IsBoolean()
  coVisitFromSchedule?: boolean;

  @IsOptional()
  @IsBoolean()
  autoPrepare?: boolean;

  @IsOptional()
  @IsIn(PREPARE_LEADS)
  prepareLead?: PrepareLead;

  @IsOptional()
  @IsBoolean()
  autoPickConductors?: boolean;

  @IsOptional()
  @IsIn(UNPUBLISHED_POLICIES)
  unpublishedPolicy?: UnpublishedPolicy;
}
