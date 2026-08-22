import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MwbImportService } from './mwb-import.service';
import { ApplyParsedDto } from './dto/apply-parsed.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

const MAX_EPUB_BYTES = 25 * 1024 * 1024; // 25 MB

@Controller('mwb-import')
export class MwbImportController {
  constructor(private readonly service: MwbImportService) {}

  /**
   * What the congregation already has, so the screen can say so before
   * anybody picks a file. Elders read it; only admins and elders get here.
   */
  @Get('coverage')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  coverage(@TenantId() congregationId: string) {
    return this.service.coverage(congregationId);
  }

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
    return this.service.import(congregationId, file.buffer, file.originalname);
  }

  /**
   * Accepts a workbook parsed on the client. No publication file is
   * uploaded — the payload contains only derived schedule metadata
   * (part keys, titles, durations).
   */
  @Post('apply')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  apply(@TenantId() congregationId: string, @Body() dto: ApplyParsedDto) {
    return this.service.applyParsed(congregationId, dto);
  }
}
