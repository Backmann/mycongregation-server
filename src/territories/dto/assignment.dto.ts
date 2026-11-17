import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  Max,
  Min,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TERRITORY_METHODS } from '../../entities/territory-assignment.entity';
import { BoundaryDescriptionDto } from './import.dto';

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

  /**
   * Held back for a join of the re-cutting draft: given out anyway, and the
   * hold let go (16 November 2026).
   */
  @IsOptional()
  @IsBoolean()
  releaseHold?: boolean;
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

  /**
   * «Оставить для повторной обработки» (book ch. 9 §33): worked, reported,
   * and kept — a new line of the S-13 starts the same day for the same
   * holder, for a new term.
   */
  @IsOptional()
  @IsBoolean()
  again?: boolean;
}

/** «Вернуть без обработки» — the keepers only (17 November 2026). */
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
 * A keeper's correction of a mistake (the current and the previous service
 * year — as long as the S-13 keeps names). Absent fields stay; `reopen`
 * clears the end so the territory is held again.
 *
 * Who held it (17 November 2026): `publisherId` — a card; `holderName` —
 * «нет в списке», a name written by hand and tied to no card (moved away,
 * no longer serving). `forGroupId` — the group it was held for; null: his
 * own.
 */
export class EditAssignmentDto {
  @IsOptional()
  @IsUUID()
  publisherId?: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  holderName?: string;

  /** Null: not a group's territory. Absent: as it was. */
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsUUID()
  forGroupId?: string | null;

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

/**
 * A line of the S-13 from before the app (17 November 2026): «начать учёт с
 * бумаги». Nobody is told. From the start of the previous service year.
 */
export class PastAssignmentDto {
  @ValidateIf((o: PastAssignmentDto) => o.holderName === undefined)
  @IsUUID()
  publisherId?: string;

  @ValidateIf((o: PastAssignmentDto) => o.publisherId === undefined)
  @IsString()
  @Length(2, 160)
  holderName?: string;

  @IsOptional()
  @IsUUID()
  forGroupId?: string;

  @Matches(DAY)
  assignedOn!: string;

  @IsOptional()
  @Matches(DAY)
  dueOn?: string;

  /** How it ended; `open` — still in his hands. */
  @IsIn(['completed', 'returned', 'open'])
  end!: 'completed' | 'returned' | 'open';

  @ValidateIf((o: PastAssignmentDto) => o.end !== 'open')
  @Matches(DAY)
  endedOn?: string;

  @IsOptional()
  @IsIn(TERRITORY_METHODS)
  method?: string;
}

/**
 * A territory handed on to someone else, through the keeper (17 November
 * 2026; at first only a group's territory to the group's new overseer).
 */
export class TransferAssignmentDto {
  /** Defaults to the group's overseer. */
  @IsOptional()
  @IsUUID()
  toPublisherId?: string;

  /** Defaults to today. */
  @IsOptional()
  @Matches(DAY)
  on?: string;

  /** A new day it is due; absent: the day it was due stays. */
  @IsOptional()
  @Matches(DAY)
  dueOn?: string;
}

/** The territory a meeting for field service goes out to, or none. */
export class MeetingTerritoryDto {
  @IsOptional()
  @IsUUID()
  territoryId?: string | null;
}

/** The date of the S-54 behind the boundary (17 November 2026). */
export class BoundaryS54Dto {
  @Matches(DAY)
  s54On!: string;
}

/** A new boundary file from the branch; for a preview the date may wait. */
export class BoundaryFileDto {
  @IsObject()
  geometry!: Record<string, unknown>;

  /** The branch file's own words: borders north, east, south, west. */
  @IsOptional()
  @ValidateNested()
  @Type(() => BoundaryDescriptionDto)
  description?: BoundaryDescriptionDto;

  @IsOptional()
  @Matches(DAY)
  s54On?: string;
}

/** The journal of a territory, or «Что происходит». */
export class HistoryQueryDto {
  @IsOptional()
  @IsUUID()
  territoryId?: string;

  /** given, back, fixes, territory — one or several with commas. */
  @IsOptional()
  @Matches(/^[a-z,]{1,60}$/)
  filter?: string;

  @IsOptional()
  @IsISO8601()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SummaryQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string;
}

/** Links for printed territory maps, several at once. */
export class PrintLinksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  assignmentIds!: string[];

  @IsOptional()
  @IsBoolean()
  withNoCalls?: boolean;
}

/** A paper map wanted (true) or printed (false). */
export class PaperDto {
  @IsBoolean()
  wanted!: boolean;
}
