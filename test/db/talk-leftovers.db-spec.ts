import { Harness, startHarness } from './harness';
import { TalkExchangeService } from '../../src/talk-exchange/talk-exchange.service';

/**
 * The leftovers of the talk audit (decided with Lionel on 24 October 2026):
 * a week created after its circuit visit, a card spelt anew, what the
 * programme writes into «К нам», and «Приехал другой докладчик» whole or
 * not at all.
 */
describe('talk journal and programme, the leftovers (real database)', () => {
  let h: Harness;
  let n = 0;

  const week = (): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * (8 + 3 * ++n));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const plus = (iso: string, days: number): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const line = async (w: string) =>
    (
      await h.sql<{ id: string; name: string | null; card: string | null }>(
        `SELECT id, speaker_name AS name, visiting_speaker_id AS card
           FROM assignments
          WHERE week_start_date = $1 AND part_key = 'public_talk_speaker'
            AND deleted_at IS NULL`,
        [w],
      )
    )[0];
  const live = (w: string) =>
    h.sql<{ id: string; name: string | null; status: string }>(
      `SELECT t.id, COALESCE(t.speaker_name, v.first_name || ' ' || v.last_name) AS name, t.status
         FROM talk_exchange t LEFT JOIN visiting_speakers v ON v.id = t.visiting_speaker_id
        WHERE t.direction = 'incoming' AND t.deleted_at IS NULL
          AND t.status <> 'did_not_happen'
          AND t.date BETWEEN $1 AND $1::date + 6`,
      [w],
    );
  const card = async (firstName: string, lastName: string) => {
    const r = await h
      .as('admin')
      .post('/visiting-speakers', { firstName, lastName });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };
  const visit = async (w: string) => {
    const r = await h.as('admin').post('/special-events', {
      title: 'Визит районного',
      type: 'circuit_overseer_visit',
      date: plus(w, 1),
      coFirstName: 'Андреас',
      coLastName: 'Районный',
    });
    expect([200, 201]).toContain(r.status);
    return r.body.id as string;
  };
  const createWeek = async (w: string) => {
    const r = await h.as('admin').post('/assignments/bulk', {
      assignments: [
        {
          weekStartDate: w,
          eventType: 'weekend',
          partKey: 'public_talk_speaker',
        },
      ],
    });
    expect(r.status).toBe(201);
  };

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  describe('a week created after its circuit visit was saved', () => {
    it('removing the visit takes the overseer out of the programme and of «К нам»', async () => {
      const w = week();
      const v = await visit(w);
      await createWeek(w);
      expect((await line(w)).name).toBe('Андреас Районный');
      const gone = await h.as('admin').delete(`/special-events/${v}`);
      expect([200, 204]).toContain(gone.status);
      expect((await line(w)).name).toBeNull();
      expect(await live(w)).toEqual([]);
    });

    it('a guest booked before the visit comes back when the visit goes', async () => {
      const w = week();
      const guest = await card('Фриц', 'Бауэр');
      const booked = await h.as('admin').post('/talk-exchange', {
        direction: 'incoming',
        date: plus(w, 6),
        visitingSpeakerId: guest,
      });
      expect(booked.status).toBe(201);
      const v = await visit(w);
      await createWeek(w);
      expect((await line(w)).name).toBe('Андреас Районный');
      expect((await live(w)).map((e) => e.name)).toEqual(['Андреас Районный']);
      await h.as('admin').delete(`/special-events/${v}`);
      expect((await line(w)).name).toBe('Фриц Бауэр');
      expect((await live(w)).map((e) => e.id)).toEqual([booked.body.id]);
    });
  });

  describe('a card spelt anew', () => {
    it('the lines from this week on take the new spelling; past weeks keep theirs', async () => {
      const w = week();
      const c = await card('Иван', 'Петроф');
      await createWeek(w);
      const booked = await h.as('admin').post('/talk-exchange', {
        direction: 'incoming',
        date: plus(w, 6),
        visitingSpeakerId: c,
      });
      expect(booked.status).toBe(201);
      expect((await line(w)).name).toBe('Иван Петроф');
      // A past week that named him the old way.
      const [{ cid }] = await h.sql<{ cid: string }>(
        `SELECT congregation_id AS cid FROM visiting_speakers WHERE id = $1`,
        [c],
      );
      const past = '2026-01-05';
      await h.sql(
        `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key, speaker_name, visiting_speaker_id, status)
         VALUES ($1, $2, 'weekend', 'public_talk_speaker', 'Иван Петроф', $3, 'draft')`,
        [cid, past, c],
      );
      const r = await h
        .as('admin')
        .patch(`/visiting-speakers/${c}`, { lastName: 'Петров' });
      expect(r.status).toBe(200);
      expect((await line(w)).name).toBe('Иван Петров');
      expect((await line(past)).name).toBe('Иван Петроф');
      const [{ lines }] = await h.sql<{ lines: number }>(
        `SELECT count(*)::int AS lines FROM audit_logs
          WHERE entity_type = 'visiting_speaker' AND entity_id = $1
            AND changed_fields::text LIKE '%programmeSpelling%'`,
        [c],
      );
      expect(lines).toBe(1);
    });

    it('two cards merged: the lines now his carry his name', async () => {
      const w = week();
      const keep = await card('Иван', 'Ротарюк');
      const merge = await card('Iwan', 'Rotariuk');
      await createWeek(w);
      await h.as('admin').post('/talk-exchange', {
        direction: 'incoming',
        date: plus(w, 6),
        visitingSpeakerId: merge,
      });
      expect((await line(w)).name).toBe('Iwan Rotariuk');
      const m = await h
        .as('admin')
        .post(`/visiting-speakers/${keep}/merge/${merge}`);
      expect([200, 201]).toContain(m.status);
      expect(await line(w)).toEqual(
        expect.objectContaining({ name: 'Иван Ротарюк', card: keep }),
      );
    });
  });

  describe('what the programme writes into «К нам»', () => {
    it('is written in the journal of changes, and a special talk is announced once', async () => {
      const w = week();
      await createWeek(w);
      const l = await line(w);
      // A special talk stands in the slot (the programme gets one only from
      // the journal or by swapping weeks; written straight in here).
      await h.sql(
        `UPDATE assignments SET special_talk = true, part_title = 'Особая тема' WHERE id = $1`,
        [l.id],
      );
      const r = await h.as('admin').patch(`/assignments/${l.id}`, {
        speakerName: 'Отто Беккер',
      });
      expect(r.status).toBe(200);
      const [entry] = await live(w);
      expect(entry).toBeDefined();
      const [{ created }] = await h.sql<{ created: number }>(
        `SELECT count(*)::int AS created FROM audit_logs
          WHERE entity_type = 'talk_exchange' AND entity_id = $1 AND action = 'CREATE'`,
        [entry.id],
      );
      expect(created).toBe(1);
      const told = async () =>
        (
          await h.sql<{ n: number }>(
            `SELECT count(DISTINCT dedupe_key)::int AS n FROM notification_outbox
              WHERE dedupe_key LIKE $1`,
            [`special-talk:${entry.id}:%`],
          )
        )[0].n;
      expect(await told()).toBe(1);
      // Saved again unchanged: no second announcement.
      await h
        .as('admin')
        .patch(`/assignments/${l.id}`, { speakerName: 'Отто Беккер' });
      expect(await told()).toBe(1);
    });
  });

  describe('«Приехал другой докладчик»', () => {
    it('a refusal leaves the first visit standing', async () => {
      const w = week();
      await createWeek(w);
      const first = await card('Курт', 'Фишер');
      const booked = await h.as('admin').post('/talk-exchange', {
        direction: 'incoming',
        date: plus(w, 6),
        visitingSpeakerId: first,
      });
      expect(booked.status).toBe(201);
      const r = await h.as('admin').post('/talk-exchange/replace-speaker', {
        weekStartDate: w,
        visitingSpeakerId: '00000000-0000-4000-8000-000000000000',
      });
      expect(r.status).toBe(404);
      expect((await live(w)).map((e) => e.id)).toEqual([booked.body.id]);
      expect((await line(w)).name).toBe('Курт Фишер');
    });

    it('a failure halfway puts the week back as it was', async () => {
      const w = week();
      await createWeek(w);
      const first = await card('Ганс', 'Шульц');
      const booked = await h.as('admin').post('/talk-exchange', {
        direction: 'incoming',
        date: plus(w, 6),
        visitingSpeakerId: first,
      });
      expect(booked.status).toBe(201);
      const svc = h.app.get(TalkExchangeService);
      const spy = jest
        .spyOn(svc, 'syncProgramToJournal')
        .mockRejectedValueOnce(new Error('the database went away'));
      const r = await h.as('admin').post('/talk-exchange/replace-speaker', {
        weekStartDate: w,
        speakerName: 'Пауль Новак',
      });
      spy.mockRestore();
      expect(r.status).toBe(500);
      expect((await live(w)).map((e) => e.id)).toEqual([booked.body.id]);
      expect((await line(w)).name).toBe('Ганс Шульц');
    });
  });
});
