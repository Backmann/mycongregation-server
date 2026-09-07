import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * «Приехал другой» — одно действие, совершаемое в день встречи.
 *
 * Кто приехал, называется ровно одним из трёх способов: карточкой из
 * справочника, нашим братом или именем от руки. Причина необязательна: она
 * дописывается к заметке прежней записи и нужна не приложению, а тому, кто
 * через год решает, звать ли этого брата снова.
 */
export class ReplaceSpeakerDto {
  /** Понедельник недели, у которой меняется докладчик. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStartDate!: string;

  @IsOptional()
  @IsUUID()
  visitingSpeakerId?: string;

  @IsOptional()
  @IsUUID()
  publisherId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  speakerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  speakerCongregation?: string;

  /**
   * Какую речь он говорит.
   *
   * Обязательного тут нет, но пропуск — почти всегда ошибка: приезжает другой
   * брат со СВОЕЙ речью, а слот до сих пор молча сохранял прежний номер, и
   * новому записывалась речь, которой он не произносил. Не указано — номер
   * остаётся прежним, и это осознанный случай: тот же доклад читает другой.
   */
  @IsOptional()
  @IsUUID()
  publicTalkId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  unused?: boolean;
}
