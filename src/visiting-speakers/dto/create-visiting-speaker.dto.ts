import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateVisitingSpeakerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  lastName?: string;

  @IsOptional()
  @IsUUID()
  externalCongregationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  /** Public talk outline numbers this speaker gives. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(300, { each: true })
  talkNumbers?: number[];
}
