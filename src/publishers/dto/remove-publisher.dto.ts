import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { RemovalReason } from '../../common/enums/removal-reason.enum';

export class RemovePublisherDto {
  @IsEnum(RemovalReason)
  reason!: RemovalReason;

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null ? undefined : value,
  )
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  note?: string;

  /**
   * Close the person's sign-in as well (23 October 2026). The window asks,
   * ticked by default: a departed elder kept his role, his responsibilities
   * and every report he could see before. Absent means «no» — an older app
   * that does not ask must not close anybody's sign-in behind his back.
   * His responsibilities go either way: nobody who has left the
   * congregation can be its secretary.
   */
  @IsOptional()
  @IsBoolean()
  closeAccount?: boolean;
}
