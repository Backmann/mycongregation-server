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
}
