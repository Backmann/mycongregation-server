import { TasksService } from './tasks.service';
import { ElderTask } from '../entities/elder-task.entity';
import { EldersMeeting } from '../entities/elders-meeting.entity';

function task(p: Partial<ElderTask>): ElderTask {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    congregationId: 'c1',
    title: p.title ?? 'что-то',
    details: null,
    area: p.area ?? 'other',
    assigneePublisherId: null,
    dueDate: p.dueDate ?? null,
    status: p.status ?? 'open',
    doneAt: null,
    doneById: null,
    eldersMeetingId: p.eldersMeetingId ?? null,
    createdById: null,
  } as ElderTask;
}

function svc(tasks: ElderTask[], meetings: EldersMeeting[]) {
  const qb = (rows: EldersMeeting[]) => {
    let out = rows;
    const b: Record<string, unknown> = {
      where: () => b,
      andWhere: (_s: string, params: Record<string, string>) => {
        const today = params.today ?? params.date;
        out = params.today
          ? out.filter((m) => m.date >= today)
          : out.filter((m) => m.date > today);
        return b;
      },
      orderBy: () => b,
      getOne: async () =>
        [...out].sort((a, z) => a.date.localeCompare(z.date))[0] ?? null,
    };
    return b;
  };
  return new TasksService(
    {
      find: async ({ where }: { where: { status?: string } }) =>
        tasks.filter((t) => !where.status || t.status === where.status),
    } as never,
    {
      findOne: async ({ where }: { where: { id: string } }) =>
        meetings.find((m) => m.id === where.id) ?? null,
      createQueryBuilder: () => qb(meetings),
    } as never,
    // Publishers — only reached when a task names brothers, which the agenda
    // tests never do.
    { find: async () => [] } as never,
  );
}

const MEETINGS = [
  { id: 'm1', date: '2026-08-05' },
  { id: 'm2', date: '2026-09-02' },
] as EldersMeeting[];

describe('agenda — what belongs in front of the body', () => {
  const TODAY = '2026-07-28';

  it('takes the next meeting when none is named', async () => {
    const s = svc([], MEETINGS);
    const { meeting } = await s.agenda('c1', null, TODAY);
    expect(meeting?.id).toBe('m1');
  });

  it('separates what was put on the agenda from what merely fell due', async () => {
    const s = svc(
      [
        task({ id: 'a', eldersMeetingId: 'm1' }),
        task({ id: 'b', dueDate: '2026-07-01' }), // long past
        task({ id: 'c', dueDate: '2026-08-20' }), // before the NEXT meeting
        task({ id: 'd', dueDate: '2026-11-01' }), // far beyond it
      ],
      MEETINGS,
    );
    const r = await s.agenda('c1', 'm1', TODAY);
    expect(r.onAgenda.map((t) => t.id)).toEqual(['a']);
    expect(r.overdue.map((t) => t.id)).toEqual(['b']);
    expect(r.dueSoon.map((t) => t.id)).toEqual(['c']);
  });

  // A task deliberately put on the agenda is not repeated among the overdue:
  // seeing one item twice makes a person doubt they read the first correctly.
  it('never lists the same task twice', async () => {
    const s = svc(
      [task({ id: 'a', eldersMeetingId: 'm1', dueDate: '2026-07-01' })],
      MEETINGS,
    );
    const r = await s.agenda('c1', 'm1', TODAY);
    expect(r.onAgenda).toHaveLength(1);
    expect(r.overdue).toHaveLength(0);
  });

  it('leaves closed tasks out entirely', async () => {
    const s = svc(
      [task({ id: 'a', eldersMeetingId: 'm1', status: 'done' })],
      MEETINGS,
    );
    const r = await s.agenda('c1', 'm1', TODAY);
    expect(r.onAgenda).toHaveLength(0);
  });

  // With no meeting after this one on record, everything ahead counts: better
  // to raise something early than to let it pass unmentioned.
  it('takes the whole future when no later meeting is planned', async () => {
    const s = svc([task({ id: 'd', dueDate: '2026-11-01' })], [MEETINGS[1]]);
    const r = await s.agenda('c1', 'm2', TODAY);
    expect(r.dueSoon.map((t) => t.id)).toEqual(['d']);
  });
});
