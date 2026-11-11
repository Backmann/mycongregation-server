import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import { TERRITORY_METHODS } from '../../entities/territory-assignment.entity';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Giving a territory out (11 November 2026). */
export class AssignTerritoryDto {
  @IsUUID()
  publisherId!: string;

  /** «Участок группы»: the holder takes it for his group. */
  @IsOptional()
  @IsUUID()
  forGroupId?: string;

  /** Defaults to today. */
  @IsOptional()
  @Matches(DAY)
  assignedOn?: string;

  /** Defaults to four months on. */
  @IsOptional()
  @Matches(DAY)
  dueOn?: string;
}

/** «Участок пройден». */
export class CompleteAssignmentDto {
  /** Defaults to today. */
  @IsOptional()
  @Matches(DAY)
  completedOn?: string;

  /** Defaults to door to door. */
  @IsOptional()
  @IsIn(TERRITORY_METHODS)
  method?: string;
}

/** «Вернуть без обработки». */
export class ReturnAssignmentDto {
  /** Defaults to today. */
  @IsOptional()
  @Matches(DAY)
  returnedOn?: string;
}

/**
 * «Нужно ещё время». The holder may ask once, for a month; a keeper sets
 * any later day.
 */
export class ExtendAssignmentDto {
  @IsOptional()
  @Matches(DAY)
  dueOn?: string;
}

/**
 * A keeper's correction of a mistake (current service year only). Absent
 * fields stay; `reopen` clears the end so the territory is held again.
 */
export class EditAssignmentDto {
  @IsOptional()
  @Matches(DAY)
  assignedOn?: string;

  @IsOptional()
  @Matches(DAY)
  dueOn?: string;

  @IsOptional()
  @Matches(DAY)
  completedOn?: string;

  @IsOptional()
  @Matches(DAY)
  returnedOn?: string;

  @IsOptional()
  @IsIn(TERRITORY_METHODS)
  method?: string;

  @IsOptional()
  @IsBoolean()
  reopen?: boolean;
}

/** «Обработаны в кампанию»: free territories worked in a campaign. */
export class CampaignDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  territoryIds!: string[];

  /** Defaults to today. */
  @IsOptional()
  @Matches(DAY)
  workedOn?: string;
}

/** A group's territory handed on to the group's new overseer. */
export class TransferAssignmentDto {
  /** Defaults to the group's overseer. */
  @IsOptional()
  @IsUUID()
  toPublisherId?: string;

  /** Defaults to today. */
  @IsOptional()
  @Matches(DAY)
  on?: string;
}

/** The territory a meeting for field service goes out to, or none. */
export class MeetingTerritoryDto {
  @IsOptional()
  @IsUUID()
  territoryId?: string | null;
}

export class SummaryQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string;
}
