import { IsIn, IsString } from 'class-validator';
import { PUSH_STATES } from '../../notifications/notification-reach.service';

/** What this device says about notifications. The list is closed. */
export class ReportPushStateDto {
  @IsString()
  @IsIn(PUSH_STATES as unknown as string[])
  state!: string;
}
