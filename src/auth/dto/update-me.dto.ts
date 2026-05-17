import { IsIn, IsOptional, IsString } from 'class-validator';
import { SUPPORTED_LANGUAGES } from '../../common/i18n/supported-languages';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @IsIn([...SUPPORTED_LANGUAGES], {
    message: `uiLanguage must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`,
  })
  uiLanguage?: string;
}
