import { IsEnum } from 'class-validator';
import { PublisherStatus } from '../../common/enums/publisher-status.enum';

export class OverrideStatusDto {
  @IsEnum(PublisherStatus)
  status!: PublisherStatus;
}
