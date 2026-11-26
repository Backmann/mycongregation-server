import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnnouncementTemplate } from '../entities/announcement-template.entity';
import { Congregation } from '../entities/congregation.entity';
import { coerceLanguage } from '../common/i18n/supported-languages';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { AnnouncementsService } from './announcements.service';
import {
  TEMPLATE_KEYS,
  TEMPLATE_TOKENS,
  TEMPLATE_WEEKS,
  WEEKS_MAX,
  WEEKS_MIN,
  WORDS_MAX,
  defaultWords,
  isTemplateKey,
  unknownTokens,
  strayBraces,
  hasControlChars,
  type TemplateKey,
  type TemplateSetting,
  type Templates,
} from './announcement-templates';

export interface TemplateView {
  key: TemplateKey;
  enabled: boolean;
  /** The congregation's own words; null — the app's. */
  words: string | null;
  /** The app's words with their placeholders, in the congregation's language. */
  defaultWords: string | null;
  /** The placeholders the words may use. */
  tokens: readonly string[];
  /** Null when the template is not offered weeks ahead. */
  weeksAhead: number | null;
  defaultWeeks: number | null;
}

/**
 * The «Templates» screen (announcements R-05, R-09 step 4): read by the
 * rules every time they compute, changed by the writers only.
 */
@Injectable()
export class AnnouncementTemplatesService {
  constructor(
    private readonly announcements: AnnouncementsService,
    private readonly auditLog: AuditLogService,
    @InjectRepository(AnnouncementTemplate)
    private readonly repo: Repository<AnnouncementTemplate>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
  ) {}

  /** The congregation's settings, as the rules read them. */
  async load(congregationId: string): Promise<Templates> {
    const rows = await this.repo.find({ where: { congregationId } });
    const map = new Map<TemplateKey, TemplateSetting>();
    for (const r of rows) {
      if (!isTemplateKey(r.key)) continue;
      map.set(r.key, {
        enabled: r.enabled,
        words: r.words,
        weeksAhead: r.weeksAhead,
      });
    }
    return map;
  }

  async list(user: AuthenticatedUser): Promise<TemplateView[]> {
    await this.announcements.assertWriter(user);
    const congregationId = user.congregationId;
    const [map, cong] = await Promise.all([
      this.load(congregationId),
      this.congregations.findOne({
        where: { id: congregationId },
        select: { id: true, language: true },
      }),
    ]);
    const lang = coerceLanguage(cong?.language);
    return TEMPLATE_KEYS.map((key) => {
      const s = map.get(key);
      const defaultWeeks = TEMPLATE_WEEKS[key] ?? null;
      return {
        key,
        enabled: s?.enabled ?? true,
        words: s?.words ?? null,
        defaultWords: defaultWords(key, lang),
        tokens: TEMPLATE_TOKENS[key],
        weeksAhead: defaultWeeks == null ? null : (s?.weeksAhead ?? null),
        defaultWeeks,
      };
    });
  }

  async update(
    user: AuthenticatedUser,
    key: string,
    dto: {
      enabled?: boolean;
      words?: string | null;
      weeksAhead?: number | null;
    },
  ): Promise<TemplateView> {
    await this.announcements.assertWriter(user);
    if (!isTemplateKey(key)) {
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'Unknown template.', { field: 'key' }),
      );
    }
    let words = dto.words === undefined ? undefined : dto.words;
    if (typeof words === 'string') {
      words = words.trim();
      if (!words) words = null;
    }
    if (typeof words === 'string') {
      if (!TEMPLATE_TOKENS[key].length) {
        throw new BadRequestException(
          refusal('INVALID_FIELD', 'This template has no words of its own.', {
            field: 'words',
          }),
        );
      }
      if (words.length > WORDS_MAX) {
        throw new BadRequestException(
          refusal('INVALID_FIELD', 'The words are too long.', {
            field: 'words',
          }),
        );
      }
      if (hasControlChars(words)) {
        throw new BadRequestException(
          refusal('INVALID_FIELD', 'The words hold a control character.', {
            field: 'words',
          }),
        );
      }
      const unknown = unknownTokens(key, words);
      if (unknown.length || strayBraces(words)) {
        throw new BadRequestException(
          refusal(
            'ANNOUNCEMENT_TEMPLATE_TOKEN',
            'The words use a placeholder this template does not know.',
            { field: 'words', tokens: unknown },
          ),
        );
      }
    }
    const weeks = dto.weeksAhead;
    if (weeks !== undefined && weeks !== null) {
      if (TEMPLATE_WEEKS[key] == null) {
        throw new BadRequestException(
          refusal(
            'INVALID_FIELD',
            'This template is not offered weeks ahead.',
            {
              field: 'weeksAhead',
            },
          ),
        );
      }
      if (!Number.isInteger(weeks) || weeks < WEEKS_MIN || weeks > WEEKS_MAX) {
        throw new BadRequestException(
          refusal('INVALID_FIELD', 'Weeks out of range.', {
            field: 'weeksAhead',
          }),
        );
      }
    }

    const congregationId = user.congregationId;
    const apply = async () => {
      let row = await this.repo.findOne({ where: { congregationId, key } });
      // No row yet is the app's own: on, its words, its weeks. A change to
      // exactly that writes nothing (found by the independent check).
      const before = row
        ? JSON.stringify([row.enabled, row.words, row.weeksAhead])
        : JSON.stringify([true, null, null]);
      if (!row) row = this.repo.create({ congregationId, key, enabled: true });
      if (dto.enabled !== undefined) row.enabled = dto.enabled;
      if (words !== undefined) row.words = words;
      if (weeks !== undefined) row.weeksAhead = weeks;
      row.updatedByUserId = user.id;
      const changed =
        before !== JSON.stringify([row.enabled, row.words, row.weeksAhead]);
      return { saved: changed ? await this.repo.save(row) : row, changed };
    };
    let result: Awaited<ReturnType<typeof apply>>;
    try {
      result = await apply();
    } catch (e) {
      // Two first changes at once: the other made the row; apply to it.
      if ((e as { code?: string }).code !== '23505') throw e;
      result = await apply();
    }
    const { saved, changed } = result;
    if (changed)
      try {
        // What changed, not the words: the journal keeps a year.
        await this.auditLog.logFact({
          tenantId: congregationId,
          entityType: 'announcement_template',
          entityId: saved.id,
          action: 'UPDATE',
          actorUserId: user.id,
          detail: {
            key,
            ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
            ...(words !== undefined ? { ownWords: words !== null } : {}),
            ...(weeks !== undefined ? { weeksAhead: weeks } : {}),
          },
        });
      } catch {
        // The journal never stops the change it records.
      }
    return (await this.list(user)).find((v) => v.key === key)!;
  }
}
