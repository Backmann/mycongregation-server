import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MwbImportService } from '../mwb-import/mwb-import.service';
import { WtImportService } from '../wt-import/wt-import.service';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

const MAX_EPUB_BYTES = 25 * 1024 * 1024;

type ImportType = 'mwb' | 'watchtower';

/**
 * Detect EPUB type by filename pattern.
 * - mwb_X_YYYYMM.epub  → midweek (Meeting Workbook)
 * - w_X_YYYYMM.epub    → watchtower (Study edition)
 * - wp_X_YYYYMM.epub   → watchtower (Public edition, future)
 */
function detectImportType(filename: string): ImportType | null {
  const base = filename.toLowerCase();
  if (base.startsWith('mwb_') || base.startsWith('mwb-')) return 'mwb';
  if (base.startsWith('w_') || base.startsWith('wp_')) return 'watchtower';
  return null;
}

@Controller('schedule-import')
export class ScheduleImportController {
  constructor(
    private readonly mwbService: MwbImportService,
    private readonly wtService: WtImportService,
  ) {}

  @Post('upload')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_EPUB_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!/\.epub$/i.test(file.originalname)) {
          cb(new BadRequestException('Only .epub files are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async upload(
    @TenantId() congregationId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No file uploaded (field name must be "file")',
      );
    }

    const type = detectImportType(file.originalname);
    if (!type) {
      throw new BadRequestException(
        `Unrecognized EPUB filename "${file.originalname}". ` +
          `Expected pattern: mwb_*.epub for midweek, w_*.epub or wp_*.epub for Watchtower.`,
      );
    }

    if (type === 'mwb') {
      return this.mwbService.import(
        congregationId,
        file.buffer,
        file.originalname,
      );
    }
    return this.wtService.import(
      congregationId,
      file.buffer,
      file.originalname,
    );
  }
}
