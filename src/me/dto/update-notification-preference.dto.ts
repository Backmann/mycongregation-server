import { IsBoolean, IsIn, IsString } from 'class-validator';
import { NOTIFICATION_CATEGORIES } from '../../notifications/notifications.service';

/** One switch, flipped. The category list is closed on purpose. */
export class UpdateNotificationPreferenceDto {
  @IsString()
  @IsIn(NOTIFICATION_CATEGORIES as unknown as string[])
  category!: string;

  @IsBoolean()
  enabled!: boolean;
}
