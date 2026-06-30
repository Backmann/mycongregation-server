import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class TemplateSlotDto {
  @IsInt()
  @Min(1)
  @Max(5)
  ordinal!: number;

  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be "HH:MM"',
  })
  startTime!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  address!: string;
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
