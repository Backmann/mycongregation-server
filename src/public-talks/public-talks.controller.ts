import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PublicTalksService } from './public-talks.service';
import { CreatePublicTalkDto } from './dto/create-public-talk.dto';
import { UpdatePublicTalkDto } from './dto/update-public-talk.dto';
import { BulkImportDto } from './dto/bulk-import.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

@Controller('public-talks')
export class PublicTalksController {
  constructor(private readonly service: PublicTalksService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.list({
      search,
      includeInactive: includeInactive === 'true',
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  create(@Body() dto: CreatePublicTalkDto) {
    return this.service.create(dto);
  }

  @Post('bulk-import')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  bulkImport(@Body() dto: BulkImportDto) {
    return this.service.bulkImport(dto.text);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePublicTalkDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.deactivate(id);
  }

  @Post(':id/reactivate')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.reactivate(id);
  }
}
