import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FieldServiceMonthTheme } from '../entities/field-service-month-theme.entity';
import { UpsertFieldServiceMonthThemeDto } from './dto/upsert-field-service-month-theme.dto';

@Injectable()
export class FieldServiceMonthThemesService {
  constructor(
    @InjectRepository(FieldServiceMonthTheme)
    private readonly repo: Repository<FieldServiceMonthTheme>,
  ) {}

  list(congregationId: string): Promise<FieldServiceMonthTheme[]> {
    return this.repo.find({
      where: { congregationId },
      order: { year: 'ASC', month: 'ASC' },
    });
  }

  /**
   * Set (or clear) the theme for one month. A blank theme removes the row so
   * empty months don't accumulate; returns null in that case.
   */
  async upsert(
    congregationId: string,
    dto: UpsertFieldServiceMonthThemeDto,
  ): Promise<FieldServiceMonthTheme | null> {
    const existing = await this.repo.findOne({
      where: { congregationId, year: dto.year, month: dto.month },
    });
    const theme = dto.theme.trim();
    if (!theme) {
      if (existing) await this.repo.remove(existing);
      return null;
    }
    if (existing) {
      existing.theme = theme;
      return this.repo.save(existing);
    }
    return this.repo.save(
      this.repo.create({
        congregationId,
        year: dto.year,
        month: dto.month,
        theme,
      }),
    );
  }
}
