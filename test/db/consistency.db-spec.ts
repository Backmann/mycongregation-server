import { Harness, startHarness } from './harness';
import { TalkConsistencyService } from '../../src/talk-exchange/talk-consistency.service';

/**
 * The morning comparison of the talk journal and the weekend programme
 * (Lionel, 23 October 2026): a difference reaches the administrators once,
 * the same one is not repeated, and agreement says nothing.
 */
describe('morning check: journal against programme (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let svc: TalkConsistencyService;

  const monday = (weeksAhead: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * weeksAhead);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const sunday = (m: string): string => {
    const d = new Date(`${m}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  };
  const notices = async () =>
    (
      await h.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM notification_outbox WHERE dedupe_key LIKE 'talk-consistency:%'`,
      )
    )[0].n;

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    svc = h.app.get(TalkConsistencyService);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('says nothing while they agree, tells a difference once, and a new one again', async () => {
    const w1 = monday(3);
    const w2 = monday(4);
    const slots: string[] = [];
    for (const w of [w1, w2]) {
      const r = await h.as('admin').post('/assignments', {
        weekStartDate: w,
        eventType: 'weekend',
        partKey: 'public_talk_speaker',
      });
      expect(r.status).toBe(201);
      slots.push(r.body.id);
    }
    const card = await h
      .as('admin')
      .post('/visiting-speakers', { firstName: 'Иван', lastName: 'Ротарюк' });
    const booked = await h.as('admin').post('/talk-exchange', {
      direction: 'incoming',
      date: sunday(w1),
      visitingSpeakerId: card.body.id,
    });
    expect(booked.status).toBe(201);

    expect(await svc.runFor(tenantId)).toEqual([]);
    expect(await notices()).toBe(0);

    // A path that brings them apart: the line names somebody else.
    await h.sql(
      `UPDATE assignments SET speaker_name = 'Петер Кох', visiting_speaker_id = NULL WHERE id = $1`,
      [slots[0]],
    );
    const found = await svc.runFor(tenantId);
    expect(found).toEqual([
      expect.objectContaining({
        weekStartDate: w1,
        kind: 'other_speaker',
        programme: 'Петер Кох',
        journal: 'Иван Ротарюк',
      }),
    ]);
    expect(await notices()).toBeGreaterThan(0);
    const [said] = await h.sql<{ title: string; body: string }>(
      `SELECT title, body FROM notification_outbox WHERE dedupe_key LIKE 'talk-consistency:%'`,
    );
    expect(said.title).toBe('Журнал и программа расходятся на одной неделе');
    expect(said.body).toContain(
      'в программе Петер Кох, в журнале Иван Ротарюк',
    );
    const once = await notices();
    await svc.runFor(tenantId);
    expect(await notices()).toBe(once);

    // A second difference is a new set: told again.
    await h.sql(
      `UPDATE assignments SET speaker_name = 'Отто Беккер' WHERE id = $1`,
      [slots[1]],
    );
    const two = await svc.runFor(tenantId);
    expect(two.map((m) => m.kind)).toEqual(['other_speaker', 'no_entry']);
    expect(await notices()).toBeGreaterThan(once);
  });
});
