import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** The measure of the draft (15 November 2026). */
export class RecutMeasureDto {
  @IsNumber() @Min(1) @Max(200) cityMaxKm!: number;
  @IsNumber() @Min(1) @Max(200) cityTargetKm!: number;
  @IsNumber() @Min(1) @Max(200) remoteMaxKm!: number;
  @IsNumber() @Min(1) @Max(200) remoteTargetKm!: number;
  @IsNumber() @Min(0.5) @Max(200) minKm!: number;
  @IsNumber() @Min(1) @Max(120) remoteMinutes!: number;
}

class RecutLineDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(500)
  @IsArray({ each: true })
  points!: number[][];
}

/**
 * A proposal: a cut (one territory, the lines, which part keeps the
 * number, the numbers of the others) or a join (the territories, the one
 * whose number stays).
 */
export class RecutProposalDto {
  @IsIn(['cut', 'merge'])
  kind!: 'cut' | 'merge';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsUUID('all', { each: true })
  territoryIds!: string[];

  @ValidateIf((o: RecutProposalDto) => o.kind === 'cut')
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => RecutLineDto)
  lines?: RecutLineDto[];

  @ValidateIf((o: RecutProposalDto) => o.kind === 'cut')
  @IsInt()
  @Min(0)
  @Max(7)
  keep?: number;

  @ValidateIf((o: RecutProposalDto) => o.kind === 'cut')
  @IsArray()
  @ArrayMaxSize(7)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(40, { each: true })
  numbers?: string[];

  @ValidateIf((o: RecutProposalDto) => o.kind === 'merge')
  @IsUUID()
  keepId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  queue?: number;
}

/** «No remarks», or a remark about the border. */
export class RecutRemarkDto {
  @IsBoolean()
  ok!: boolean;

  @ValidateIf((o: RecutRemarkDto) => !o.ok)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text?: string;
}

/** The keepers' word on a territory: city or far; null — by the minutes. */
export class RecutClassDto {
  @IsOptional()
  @IsIn(['city', 'far'])
  cls!: 'city' | 'far' | null;
}
