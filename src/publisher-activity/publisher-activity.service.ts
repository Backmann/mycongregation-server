import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';

export interface ActivityItem {
  weekStartDate: string;
  eventType: string;
  kind: 'part' | 'duty';
  // part
  partKey?: string;
  partTitle?: string | null;
  role?: 'primary' | 'assistant';
  // duty
  dutyType?: string;
  slotIndex?: number;
  customLabel?: string | null;
}

export interface PublisherActivity {
  publisherId: string;
  items: ActivityItem[];
}

export interface PartSuggestion {
  publisherId: string;
  /** Last week (strictly before the target week) they led one of the parts. */
  lastPrimaryAt: string | null;
  /** Last week they assisted on one of the parts. */
  lastAssistantAt: string | null;
  /** Most recent distinct assistants when they led (newest first, max 3). */
  recentAssistants: { publisherId: string; weekStartDate: string }[];
}

@Injectable()
export class PublisherActivityService {
  constructor(
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(Duty)
    private readonly dutyRepo: Repository<Duty>,
  ) {}

  /**
   * Per-publisher list of their program parts (as primary or assistant) and
   * duties for the current week plus `weeks` prior weeks. One query each; the
   * app formats the labels (i18n) and splits "today" vs recent client-side.
   */
  async getActivity(
    congregationId: string,
    weekStart: string,
    weeks = 4,
  ): Promise<PublisherActivity[]> {
    const start = new Date(`${weekStart}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - weeks * 7);
    const from = start.toISOString().slice(0, 10);

    const [assignments, duties] = await Promise.all([
      this.assignmentRepo.find({
        where: { congregationId, weekStartDate: Between(from, weekStart) },
      }),
      this.dutyRepo.find({
        where: { congregationId, weekStartDate: Between(from, weekStart) },
      }),
    ]);

    const map = new Map<string, ActivityItem[]>();
    const push = (publisherId: string | null, item: ActivityItem) => {
      if (!publisherId) return;
      const arr = map.get(publisherId) ?? [];
      arr.push(item);
      map.set(publisherId, arr);
    };

    for (const a of assignments) {
      const base = {
        weekStartDate: a.weekStartDate,
        eventType: a.eventType as string,
        kind: 'part' as const,
        partKey: a.partKey,
        partTitle: a.partTitle,
      };
      push(a.publisherId, { ...base, role: 'primary' });
      push(a.assistantPublisherId, { ...base, role: 'assistant' });
    }
    for (const d of duties) {
      push(d.publisherId, {
        weekStartDate: d.weekStartDate,
        eventType: d.eventType as string,
        kind: 'duty',
        dutyType: d.dutyType,
        slotIndex: d.slotIndex,
        customLabel: d.customLabel,
      });
    }

    return Array.from(map.entries()).map(([publisherId, items]) => ({
      publisherId,
      items,
    }));
  }

  /**
   * Per-publisher history for a set of equivalent part keys, used to rank
   * assignment suggestions. Looks back `weeks` weeks (default 26) strictly
   * before the target week, so "last did this part" reflects genuinely
   * prior occurrences. Part-key equivalence (e.g. the apply-yourself
   * family) is decided by the client, which passes the full key list.
   */
  async getSuggestions(
    congregationId: string,
    weekStart: string,
    partKeys: string[],
    weeks = 26,
  ): Promise<PartSuggestion[]> {
    if (partKeys.length === 0) return [];
    const start = new Date(`${weekStart}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - weeks * 7);
    const from = start.toISOString().slice(0, 10);

    const rows = await this.assignmentRepo.find({
      where: { congregationId, weekStartDate: Between(from, weekStart) },
    });

    const keys = new Set(partKeys);
    const map = new Map<string, PartSuggestion>();
    const entry = (publisherId: string): PartSuggestion => {
      let e = map.get(publisherId);
      if (!e) {
        e = {
          publisherId,
          lastPrimaryAt: null,
          lastAssistantAt: null,
          recentAssistants: [],
        };
        map.set(publisherId, e);
      }
      return e;
    };

    for (const a of rows) {
      if (!keys.has(a.partKey)) continue;
      if (String(a.status) === 'cancelled') continue;
      if (a.weekStartDate >= weekStart) continue;
      if (a.publisherId) {
        const e = entry(a.publisherId);
        if (!e.lastPrimaryAt || a.weekStartDate > e.lastPrimaryAt) {
          e.lastPrimaryAt = a.weekStartDate;
        }
        if (a.assistantPublisherId) {
          e.recentAssistants.push({
            publisherId: a.assistantPublisherId,
            weekStartDate: a.weekStartDate,
          });
        }
      }
      if (a.assistantPublisherId) {
        const e = entry(a.assistantPublisherId);
        if (!e.lastAssistantAt || a.weekStartDate > e.lastAssistantAt) {
          e.lastAssistantAt = a.weekStartDate;
        }
      }
    }

    for (const e of map.values()) {
      e.recentAssistants.sort((x, y) =>
        y.weekStartDate.localeCompare(x.weekStartDate),
      );
      const seen = new Set<string>();
      e.recentAssistants = e.recentAssistants
        .filter((r) => {
          if (seen.has(r.publisherId)) return false;
          seen.add(r.publisherId);
          return true;
        })
        .slice(0, 3);
    }

    return Array.from(map.values());
  }
}
