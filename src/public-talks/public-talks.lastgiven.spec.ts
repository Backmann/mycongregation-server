import { PublicTalksService } from './public-talks.service';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';

function iso(daysFromNow: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + daysFromNow);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('PublicTalksService lastGiven (past weeks only)', () => {
  function build(histories: any[]) {
    const talk = { id: 't1', number: 11, title: 'Talk 11', isActive: true };
    const qb: any = {
      andWhere: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn(async () => [[talk], 1]),
    };
    const repo: any = { createQueryBuilder: jest.fn(() => qb) };
    const assignmentsRepo: any = { find: jest.fn(async () => histories) };
    return new PublicTalksService(repo, assignmentsRepo);
  }

  it('ignores current/future-week assignment, uses the last past delivery', async () => {
    const svc = build([
      // ordered DESC as the query returns
      {
        publicTalkId: 't1',
        weekStartDate: iso(7), // upcoming — not yet given
        status: AssignmentStatus.DRAFT,
        speakerName: 'Alexander Jakobi',
        publisher: null,
      },
      {
        publicTalkId: 't1',
        weekStartDate: iso(-60), // past delivery
        status: AssignmentStatus.PUBLISHED,
        speakerName: 'Past Speaker',
        publisher: null,
      },
    ]);
    const res = await svc.list('cong-1', {});
    const t = res.data[0] as any;
    console.log('lastGivenAt:', t.lastGivenAt, 'by:', t.lastGivenBy);
    expect(t.lastGivenAt).toBe(iso(-60));
    expect(t.lastGivenBy).toBe('Past Speaker');
  });

  it('null when the only assignment is the upcoming one', async () => {
    const svc = build([
      {
        publicTalkId: 't1',
        weekStartDate: iso(7),
        status: AssignmentStatus.DRAFT,
        speakerName: 'Alexander Jakobi',
        publisher: null,
      },
    ]);
    const res = await svc.list('cong-1', {});
    const t = res.data[0] as any;
    console.log('lastGivenAt(none):', t.lastGivenAt);
    expect(t.lastGivenAt).toBeNull();
    expect(t.lastGivenBy).toBeNull();
  });
});
