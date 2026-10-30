import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, Matches } from 'class-validator';
import { CreatePublisherDto } from './create-publisher.dto';

export class UpdatePublisherDto extends PartialType(CreatePublisherDto) {
  /**
   * When the card stops being a pioneer's: the last month he served, YYYY-MM
   * (30 October 2026). Said by the secretary, it may be a month already past;
   * left out, the spell ends in the current month — as it always did, and as
   * older apps still send it.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  pioneerEndMonth?: string;
}
