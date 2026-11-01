import { Harness, startHarness } from './harness';

/**
 * An inactive publisher is given no task — nobody may override, elders
 * included (Lionel, 31 October 2026). Against a real database, 1 November
 * 2026: every way of putting a person somewhere refuses a NEW inactive one
 * with a code that names no standing, and a part he already holds can still
 * be edited.
 */
describe('an inactive publisher is put on nothing (real database)', () => {
  let h: Harness;
  const ids: Record<string, string> = {};

  const monday = (weeks: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * weeks);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const inDays = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const setStatus = (id: string, status: string) =>
    h.sql(
      `UPDATE publishers SET status = $1, status_manually_overridden = true WHERE id = $2`,
      [status, id],
    );
  const refused = (res: { status: number; body: { code?: string } }) => {
    expect([res.status, res.body.code]).toEqual([400, 'PERSON_NOT_ASSIGNABLE']);
    expect(JSON.stringify(res.body)).not.toMatch(/inactive|неактив/i);
  };

  beforeAll(async () => {
    h = await startHarness();
    const card = async (first: string, appointment: string) => {
      const id = await h.addPublisher({
        firstName: first,
        lastName: 'Тест',
        gender: 'brother',
        appointment,
        baptismDate: '1990-01-01',
      });
      await setStatus(id, 'active');
      return id;
    };
    ids.away = await card('Ушедший', 'elder');
    await setStatus(ids.away, 'inactive');
    ids.awayUser = await h.addUser({
      login: 'away',
      role: 'elder',
      publisherId: ids.away,
    });
    ids.ok = await card('Служащий', 'elder');
    ids.later = await card('Позже', 'publisher');
  });
  afterAll(async () => {
    await h?.close();
  });

  it('the programme: refused for him, given to another', async () => {
    const part = {
      weekStartDate: monday(3),
      eventType: 'midweek',
      partKey: 'bible_reading',
      partOrder: 3,
      partTitle: 'Чтение Библии',
      partDurationMin: 4,
      status: 'draft',
    };
    refused(
      await h
        .as('admin')
        .post('/assignments', { ...part, publisherId: ids.away }),
    );
    refused(
      await h.as('admin').post('/assignments/bulk', {
        assignments: [{ ...part, publisherId: ids.away }],
      }),
    );
    const ok = await h
      .as('admin')
      .post('/assignments', { ...part, publisherId: ids.later });
    expect(ok.status).toBe(201);

    // He lapses after the part was given: it can still be edited…
    await setStatus(ids.later, 'inactive');
    const edit = await h.as('admin').patch(`/assignments/${ok.body.id}`, {
      partTitle: 'Чтение Библии (изм.)',
      publisherId: ids.later,
    });
    expect(edit.status).toBe(200);
    // …but nobody inactive is put into it anew.
    refused(
      await h.as('admin').patch(`/assignments/${ok.body.id}`, {
        assistantPublisherId: ids.away,
      }),
    );
    await setStatus(ids.later, 'active');
  });

  it('meeting duties: a cell and a place of its own', async () => {
    refused(
      await h.as('admin').post('/duties/assign-place', {
        weekStartDate: monday(4),
        eventType: 'midweek',
        dutyType: 'microphone',
        ordinal: 0,
        publisherId: ids.away,
      }),
    );
  });

  it('a meeting with the pioneers', async () => {
    refused(
      await h.as('admin').post('/pioneer-meetings', {
        date: inDays(12),
        timeStart: '11:30',
        conductorPublisherId: ids.away,
      }),
    );
  });

  it("the elders' tasks", async () => {
    refused(
      await h.as('admin').post('/tasks', {
        title: 'Проверка',
        area: 'other',
        assigneeKind: 'people',
        assigneePublisherIds: [ids.ok, ids.away],
      }),
    );
  });

  it("a group's overseer", async () => {
    refused(
      await h.as('admin').post('/service-groups', {
        name: 'Пусто',
        overseerPublisherId: ids.away,
      }),
    );
  });

  it('a responsibility', async () => {
    refused(
      await h.as('admin').post('/responsibilities', {
        type: 'cleaning_coordinator',
        userId: ids.awayUser,
      }),
    );
  });
});
