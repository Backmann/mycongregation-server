import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AgendaSeen } from '../entities/agenda-seen.entity';
import { CongregationClock } from '../common/congregation-clock.service';
import { AgendaService } from './agenda.service';
import type { AgendaItem } from './agenda.types';

/** What of an item counts as a change worth «изменено». */
export type ChangedField = 'date' | 'start' | 'title' | 'with' | 'place';

export interface AgendaChange {
  /** The agenda item's id (agenda.types.ts). */
  id: string;
  kind: 'new' | 'changed';
  /** For «changed»: what differs, and what it was. */
  fields: ChangedField[];
  before: {
    date: string;
    start: string | null;
    title: string;
    with: string[];
    place: string | null;
  } | null;
}

export interface AgendaRemoval {
  id: string;
  date: string;
  start: string | null;
  title: string;
}

export interface AgendaChanges {
  /** Nothing seen yet: no marks at all, or everything would be «новое». */
  first: boolean;
  changes: AgendaChange[];
  removed: AgendaRemoval[];
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * «Изменено» on Home (9 November 2026, Lionel's choice «б»): what changed in
 * the person's own coming items since they last saw Home — on any device.
 * Only what matters: the day, the hour, what it is, who with, where. The
 * comparison is with what they saw, not with what they were told: a push
 * goes out ten minutes after an edit, and a mark that died with it would
 * say nothing to someone who missed the push.
 */
@Injectable()
export class AgendaSeenService {
  constructor(
    @InjectRepository(AgendaSeen)
    private readonly seen: Repository<AgendaSeen>,
    private readonly agenda: AgendaService,
    private readonly clock: CongregationClock,
  ) {}

  /** The person's own items from today on, as the agenda gives them. */
  private async mine(
    congregationId: string,
    userId: string,
  ): Promise<AgendaItem[]> {
    const a = await this.agenda.forUser(congregationId, userId);
    return a.items.filter((x) => x.scope === 'mine');
  }

  async changes(
    congregationId: string,
    userId: string,
  ): Promise<AgendaChanges> {
    const today = await this.clock.todayFor(congregationId);
    const [items, rows] = await Promise.all([
      this.mine(congregationId, userId),
      this.seen.find({ where: { congregationId, userId } }),
    ]);
    if (rows.length === 0) return { first: true, changes: [], removed: [] };
    const before = new Map(rows.map((r) => [r.itemId, r]));
    const changes: AgendaChange[] = [];
    for (const it of items) {
      const was = before.get(it.id);
      if (!was) {
        changes.push({ id: it.id, kind: 'new', fields: [], before: null });
        continue;
      }
      const withNow = [...it.with].sort();
      const fields: ChangedField[] = [];
      if (day(was.date) !== it.date) fields.push('date');
      if ((was.start ?? null) !== (it.start ?? null)) fields.push('start');
      if (was.title !== it.title) fields.push('title');
      if (!sameList(was.with ?? [], withNow)) fields.push('with');
      if ((was.place ?? null) !== (it.place ?? null)) fields.push('place');
      if (fields.length) {
        changes.push({
          id: it.id,
          kind: 'changed',
          fields,
          before: {
            date: day(was.date),
            start: was.start ?? null,
            title: was.title,
            with: was.with ?? [],
            place: was.place ?? null,
          },
        });
      }
    }
    const now = new Set(items.map((x) => x.id));
    const removed: AgendaRemoval[] = rows
      // Gone from the agenda, and not because its day has passed.
      .filter((r) => !now.has(r.itemId) && day(r.date) >= today)
      .map((r) => ({
        id: r.itemId,
        date: day(r.date),
        start: r.start ?? null,
        title: r.title,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { first: false, changes, removed };
  }

  /** Home was seen: what it showed becomes what the person knows. */
  async markSeen(
    congregationId: string,
    userId: string,
  ): Promise<{ items: number }> {
    const today = await this.clock.todayFor(congregationId);
    const items = await this.mine(congregationId, userId);
    await this.seen.manager.transaction(async (em) => {
      const repo = em.getRepository(AgendaSeen);
      await repo.delete({ congregationId, userId });
      if (items.length) {
        await repo.insert(
          items.map((it) => ({
            userId,
            itemId: it.id,
            congregationId,
            date: it.date,
            start: it.start ?? null,
            title: it.title,
            with: [...it.with].sort(),
            place: it.place ?? null,
          })),
        );
      }
    });
    // Days gone by say nothing any more (kept tidy for everybody).
    await this.seen.delete({ congregationId, date: LessThan(today) });
    return { items: items.length };
  }
}

function day(d: string | Date): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}
