import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { COMMITTEE_SEATS } from '../../entities/aux-pioneer-application.entity';

export class AuxApplicationDto {
  /** The months («YYYY-MM»); one month to begin with for «until cancelled». */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(24)
  @Matches(/^\d{4}-\d{2}$/, { each: true })
  months!: string[];

  @IsOptional()
  @IsBoolean()
  untilCancelled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @Matches(/^\d{4}-\d{2}$/, { each: true })
  reducedMonths?: string[];

  /** «Подтверждаю заявление» — the form's words, confirmed. */
  @IsBoolean()
  confirmed!: boolean;
}

export class AuxSignerDto {
  @IsIn(COMMITTEE_SEATS)
  seat!: (typeof COMMITTEE_SEATS)[number];

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

export class AuxPaperDto {
  @IsUUID()
  publisherId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(24)
  @Matches(/^\d{4}-\d{2}$/, { each: true })
  months!: string[];

  @IsOptional()
  @IsBoolean()
  untilCancelled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @Matches(/^\d{4}-\d{2}$/, { each: true })
  reducedMonths?: string[];

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paperDate!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => AuxSignerDto)
  signers!: AuxSignerDto[];
}

export class AuxApproveDto {
  @IsOptional()
  @IsIn(COMMITTEE_SEATS)
  seat?: (typeof COMMITTEE_SEATS)[number];
}

/** The last month of his own «until cancelled», YYYY-MM or YYYY-MM-DD. */
export class AuxStopMineDto {
  @Matches(/^\d{4}-\d{2}(-\d{2})?$/)
  endMonth!: string;
}
