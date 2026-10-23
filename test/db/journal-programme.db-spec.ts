import { Harness, startHarness } from './harness';
import { JournalOwnsWeekendSpeaker1913000000000 as M } from '../../src/migrations/1913000000000-JournalOwnsWeekendSpeaker';

/**
 * The journal «К нам» owns who speaks at a weekend; the programme shows it
 * (agreed with Lionel, 23 October 2026). Each case below is a finding of the
 * sync audit of that day, written as the behaviour the congregation expects.
 */
describe('journal and weekend programme (real database)', () => {
  let h: Harness;
  let n = 0;

  /** A Monday far enough ahead that no two cases share a week. */
  const week = (): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * (6 + 3 * ++n));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const sunday = (monday: string): string => {
    const d = new Date(`${monday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  };

  const slotFor = async (weekStartDate: string): Promise<string> => {
    const r = await h.as('admin').post('/assignments', {
      weekStartDate,
      eventType: 'weekend',
      partKey: 'public_talk_speaker',
    });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };
  const card = async (firstName: string, lastName: string): Promise<string> => {
    const r = await h
      .as('admin')
      .post('/visiting-speakers', { firstName, lastName });
    expect([200, 201]).toContain(r.status);
    return r.body.id as string;
  };
  const book = async (
    monday: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const r = await h.as('admin').post('/talk-exchange', {
      direction: 'incoming',
      date: sunday(monday),
      ...body,
    });
    return { status: r.status, body: r.body };
  };
  const slot = async (id: string) => {
    const [row] = await h.sql<{
      name: string | null;
      card: string | null;
      status: string;
    }>(
      `SELECT speaker_name AS name, visiting_speaker_id AS card, status
         FROM assignments WHERE id = $1`,
      [id],
    );
    return row;
  };
  /** The week's live entries «К нам». */
  const entries = (monday: string) =>
    h.sql<{
      id: string;
      name: string | null;
      note: string | null;
      cancelled: boolean;
    }>(
      `SELECT id, speaker_name AS name, note, meeting_cancelled AS cancelled
         FROM talk_exchange
        WHERE direction = 'incoming' AND deleted_at IS NULL
          AND status <> 'did_not_happen'
          AND date BETWEEN $1::date AND $1::date + 6`,
      [monday],
    );

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  describe('moving and swapping weeks in the programme', () => {
    it('«move» takes the guest’s own entry along — note and all — and leaves no ghost', async () => {
      const [from, to] = [week(), week()];
      const s1 = await slotFor(from);
      const s2 = await slotFor(to);
      const a = await card('Иван', 'Ротарюк');
      const booked = await book(from, {
        visitingSpeakerId: a,
        note: 'обед у Лангов',
      });
      expect(booked.status).toBe(201);
      const r = await h.as('admin').post('/assignments/public-talk/swap', {
        eventType: 'weekend',
        sourceWeekStartDate: from,
        targetWeekStartDate: to,
        mode: 'move',
      });
      expect([200, 201]).toContain(r.status);
      expect(await entries(from)).toEqual([]);
      expect(await entries(to)).toEqual([
        expect.objectContaining({ id: booked.body.id, note: 'обед у Лангов' }),
      ]);
      expect((await slot(s1)).name).toBeNull();
      expect(await slot(s2)).toMatchObject({ name: 'Иван Ротарюк', card: a });
    });

    it('«move» onto a week that has its own guest is refused, and nothing changes', async () => {
      const [from, to] = [week(), week()];
      await slotFor(from);
      await slotFor(to);
      const a = await book(from, {
        visitingSpeakerId: await card('Карл', 'Майер'),
      });
      const b = await book(to, {
        visitingSpeakerId: await card('Пауль', 'Кох'),
      });
      const r = await h.as('admin').post('/assignments/public-talk/swap', {
        eventType: 'weekend',
        sourceWeekStartDate: from,
        targetWeekStartDate: to,
        mode: 'move',
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('TALK_WEEK_TAKEN');
      expect((await entries(from)).map((e) => e.id)).toEqual([a.body.id]);
      expect((await entries(to)).map((e) => e.id)).toEqual([b.body.id]);
    });

    it('«swap» exchanges the two entries whole, each with its own note', async () => {
      const [w1, w2] = [week(), week()];
      const s1 = await slotFor(w1);
      const s2 = await slotFor(w2);
      const a = await book(w1, {
        visitingSpeakerId: await card('Томас', 'Шульц'),
        note: 'A',
      });
      const b = await book(w2, {
        visitingSpeakerId: await card('Юрий', 'Беккер'),
        note: 'B',
      });
      const r = await h.as('admin').post('/assignments/public-talk/swap', {
        eventType: 'weekend',
        sourceWeekStartDate: w1,
        targetWeekStartDate: w2,
        mode: 'swap',
      });
      expect([200, 201]).toContain(r.status);
      expect(await entries(w1)).toEqual([
        expect.objectContaining({ id: b.body.id, note: 'B' }),
      ]);
      expect(await entries(w2)).toEqual([
        expect.objectContaining({ id: a.body.id, note: 'A' }),
      ]);
      expect((await slot(s1)).name).toBe('Юрий Беккер');
      expect((await slot(s2)).name).toBe('Томас Шульц');
    });
  });

  describe('a cancelled meeting', () => {
    it('keeps the guest’s entry, marked, and gives it back whole when the cancellation is lifted', async () => {
      const w = await week();
      const s = await slotFor(w);
      const a = await card('Ханс', 'Мюллер');
      const booked = await book(w, { visitingSpeakerId: a, note: 'с женой' });
      const off = await h
        .as('admin')
        .patch(`/assignments/${s}`, { status: 'cancelled' });
      expect(off.status).toBe(200);
      expect(await entries(w)).toEqual([
        expect.objectContaining({
          id: booked.body.id,
          note: 'с женой',
          cancelled: true,
        }),
      ]);
      const on = await h
        .as('admin')
        .patch(`/assignments/${s}`, { status: 'draft' });
      expect(on.status).toBe(200);
      expect(await entries(w)).toEqual([
        expect.objectContaining({
          id: booked.body.id,
          note: 'с женой',
          cancelled: false,
        }),
      ]);
      expect(await slot(s)).toMatchObject({ name: 'Ханс Мюллер', card: a });
    });

    it('a guest booked onto a cancelled weekend stays booked, and a later save of the week does not drop him', async () => {
      const w = await week();
      const s = await slotFor(w);
      await h.as('admin').patch(`/assignments/${s}`, { status: 'cancelled' });
      const booked = await book(w, {
        visitingSpeakerId: await card('Пётр', 'Шмидт'),
      });
      expect(booked.status).toBe(201);
      await h.as('admin').patch(`/assignments/${s}`, { partDurationMin: 30 });
      expect(await entries(w)).toEqual([
        expect.objectContaining({ id: booked.body.id, cancelled: true }),
      ]);
      expect((await slot(s)).status).toBe('cancelled');
    });

    it('those who answer for the talks are told', async () => {
      const w = await week();
      const s = await slotFor(w);
      const booked = await book(w, {
        visitingSpeakerId: await card('Георг', 'Вольф'),
      });
      await h.as('admin').patch(`/assignments/${s}`, { status: 'cancelled' });
      const told = await h.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM notification_outbox
          WHERE kind = 'talk_exchange_attention' AND data->>'entryId' = $1`,
        [booked.body.id],
      );
      expect(told[0].n).toBeGreaterThan(0);
    });
  });

  describe('one entry a week', () => {
    it('a second guest for the same weekend is refused', async () => {
      const w = await week();
      await slotFor(w);
      await book(w, { visitingSpeakerId: await card('Марк', 'Фогт') });
      const second = await book(w, {
        visitingSpeakerId: await card('Тимо', 'Ланг'),
      });
      expect(second.status).toBe(400);
      expect(second.body.code).toBe('TALK_WEEK_TAKEN');
    });

    it('moving an entry to another week empties the old week’s programme line and fills the new one', async () => {
      const [w1, w2] = [week(), week()];
      const s1 = await slotFor(w1);
      const s2 = await slotFor(w2);
      const booked = await book(w1, {
        visitingSpeakerId: await card('Давид', 'Келлер'),
      });
      const r = await h
        .as('admin')
        .patch(`/talk-exchange/${booked.body.id as string}`, {
          date: sunday(w2),
        });
      expect(r.status).toBe(200);
      expect((await slot(s1)).name).toBeNull();
      expect((await slot(s2)).name).toBe('Давид Келлер');
    });
  });

  describe('replacing and undoing', () => {
    it('removing the missed visit leaves the brother who came in the programme', async () => {
      const w = await week();
      const s = await slotFor(w);
      const first = await book(w, {
        visitingSpeakerId: await card('Курт', 'Ланге'),
      });
      const other = await card('Эрих', 'Хан');
      const rep = await h.as('admin').post('/talk-exchange/replace-speaker', {
        weekStartDate: w,
        visitingSpeakerId: other,
      });
      expect([200, 201]).toContain(rep.status);
      const del = await h
        .as('admin')
        .delete(`/talk-exchange/${first.body.id as string}`);
      expect([200, 204]).toContain(del.status);
      expect(await slot(s)).toMatchObject({ name: 'Эрих Хан', card: other });
    });

    it('undo after the replacing visit got a note: one visit stands, the other is marked as not held', async () => {
      const w = await week();
      const s = await slotFor(w);
      const first = await book(w, {
        visitingSpeakerId: await card('Ральф', 'Йегер'),
      });
      await h.as('admin').post('/talk-exchange/replace-speaker', {
        weekStartDate: w,
        visitingSpeakerId: await card('Олаф', 'Вагнер'),
      });
      const [live] = await entries(w);
      await h
        .as('admin')
        .patch(`/talk-exchange/${live.id}`, { note: 'ночует у Фогтов' });
      const undo = await h
        .as('admin')
        .post(`/talk-exchange/${first.body.id as string}/undo-replacement`);
      expect([200, 201]).toContain(undo.status);
      expect((await entries(w)).map((e) => e.id)).toEqual([first.body.id]);
      expect((await slot(s)).name).toBe('Ральф Йегер');
      const [kept] = await h.sql<{ status: string; note: string }>(
        `SELECT status, note FROM talk_exchange WHERE id = $1`,
        [live.id],
      );
      expect(kept).toEqual({
        status: 'did_not_happen',
        note: 'ночует у Фогтов',
      });
    });
  });

  describe('the card behind the name', () => {
    it('a card renamed in the directory is the same brother: saving his entry asks nothing, and the programme shows the new spelling', async () => {
      const w = await week();
      const s = await slotFor(w);
      const a = await card('Иван', 'Ротарюк');
      const booked = await book(w, { visitingSpeakerId: a });
      await h.as('admin').patch(`/visiting-speakers/${a}`, {
        firstName: 'Iwan',
        lastName: 'Rotariuk',
      });
      const r = await h
        .as('admin')
        .patch(`/talk-exchange/${booked.body.id as string}`, {
          note: 'подтвердил',
        });
      expect(r.status).toBe(200);
      expect(r.body.programConflict).toBeFalsy();
      expect((await slot(s)).name).toBe('Iwan Rotariuk');
    });
  });

  describe('clearing the programme line', () => {
    it('a guest who was only typed into the programme and then cleared leaves no entry', async () => {
      const w = await week();
      const s = await slotFor(w);
      await h
        .as('admin')
        .patch(`/assignments/${s}`, { speakerName: 'Отто Беккер' });
      expect(await entries(w)).toHaveLength(1);
      await h.as('admin').patch(`/assignments/${s}`, { speakerName: null });
      expect(await entries(w)).toEqual([]);
    });

    it('a guest the coordinator booked stays booked, and the coordinators are told the programme dropped him', async () => {
      const w = await week();
      const s = await slotFor(w);
      const booked = await book(w, {
        visitingSpeakerId: await card('Вильгельм', 'Краус'),
      });
      await h.as('admin').patch(`/assignments/${s}`, { speakerName: null });
      expect((await entries(w)).map((e) => e.id)).toEqual([booked.body.id]);
      const told = await h.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM notification_outbox
          WHERE kind = 'talk_exchange_attention' AND data->>'entryId' = $1`,
        [booked.body.id],
      );
      expect(told[0].n).toBeGreaterThan(0);
    });

    it('«rebuild from the programme» never removes an entry', async () => {
      const w = await week();
      const s = await slotFor(w);
      const booked = await book(w, {
        visitingSpeakerId: await card('Бернд', 'Цимер'),
      });
      await h.as('admin').patch(`/assignments/${s}`, { speakerName: null });
      const r = await h
        .as('admin')
        .post('/talk-exchange/rebuild-from-programme', { from: w });
      expect([200, 201]).toContain(r.status);
      expect((await entries(w)).map((e) => e.id)).toEqual([booked.body.id]);
    });

    it('a programme line deleted and brought back returns with the same entry', async () => {
      const w = await week();
      const s = await slotFor(w);
      await h
        .as('admin')
        .patch(`/assignments/${s}`, { speakerName: 'Отто Мюллер' });
      const [before] = await entries(w);
      await h.as('admin').patch(`/talk-exchange/${before.id}`, { note: 'N' });
      await h.as('admin').delete(`/assignments/${s}`);
      await h.as('admin').post(`/assignments/${s}/restore`);
      expect(await entries(w)).toEqual([
        expect.objectContaining({ id: before.id, note: 'N' }),
      ]);
    });
  });

  describe('the circuit overseer’s week', () => {
    it('sets the guest aside whole, asks nothing about the overseer’s own entry, and gives the guest back', async () => {
      const w = week();
      const s = await slotFor(w);
      const guest = await book(w, {
        visitingSpeakerId: await card('Фриц', 'Бауэр'),
        note: 'обед у Вагнеров',
      });
      const tue = new Date(`${w}T00:00:00Z`);
      tue.setUTCDate(tue.getUTCDate() + 1);
      const visit = await h.as('admin').post('/special-events', {
        title: 'Визит районного',
        type: 'circuit_overseer_visit',
        date: tue.toISOString().slice(0, 10),
        coFirstName: 'Андреас',
        coLastName: 'Районный',
      });
      expect([200, 201]).toContain(visit.status);
      const during = await entries(w);
      expect(during.map((e) => e.name)).toEqual(['Андреас Районный']);
      expect((await slot(s)).name).toBe('Андреас Районный');

      const note = await h
        .as('admin')
        .patch(`/talk-exchange/${during[0].id}`, { note: 'живёт у Келлеров' });
      expect(note.status).toBe(200);
      expect(note.body.programConflict).toBeFalsy();

      const gone = await h
        .as('admin')
        .delete(`/special-events/${visit.body.id as string}`);
      expect([200, 204]).toContain(gone.status);
      expect(await entries(w)).toEqual([
        expect.objectContaining({ id: guest.body.id, note: 'обед у Вагнеров' }),
      ]);
      expect((await slot(s)).name).toBe('Фриц Бауэр');
    });
  });

  describe('the migration over data from before', () => {
    it('links only lines that already show their entry, and tells the coordinator’s entries from typed ones', async () => {
      const [wa, wb] = [week(), week()];
      const sa = await slotFor(wa);
      const sb = await slotFor(wb);
      const a = await card('Лутц', 'Хоффман');
      const mine = await book(wa, { visitingSpeakerId: a });
      const [{ cid }] = await h.sql<{ cid: string }>(
        `SELECT congregation_id AS cid FROM users LIMIT 1`,
      );
      const [{ id: typed }] = await h.sql<{ id: string }>(
        `INSERT INTO talk_exchange (congregation_id, direction, date, speaker_name)
         VALUES ($1, 'incoming', $2, 'Гюнтер Майер') RETURNING id`,
        [cid, sunday(wb)],
      );
      // The line of week B names somebody else: it must not be linked.
      await h.sql(
        `UPDATE assignments SET speaker_name = 'Другой Брат', visiting_speaker_id = NULL WHERE id = $1`,
        [sb],
      );
      // As before the release: no links, every entry «journal».
      await h.sql(`UPDATE assignments SET talk_exchange_id = NULL`);
      await h.sql(`UPDATE talk_exchange SET origin = 'journal'`);

      const qr = h.db.createQueryRunner();
      await new M().up(qr);
      await new M().up(qr);
      await qr.release();

      const link = async (id: string) =>
        (
          await h.sql<{ t: string | null }>(
            `SELECT talk_exchange_id AS t FROM assignments WHERE id = $1`,
            [id],
          )
        )[0].t;
      expect(await link(sa)).toBe(mine.body.id);
      expect(await link(sb)).toBeNull();
      const origins = await h.sql<{ id: string; origin: string }>(
        `SELECT id, origin FROM talk_exchange WHERE id = ANY($1)`,
        [[mine.body.id, typed]],
      );
      expect(Object.fromEntries(origins.map((o) => [o.id, o.origin]))).toEqual({
        [mine.body.id as string]: 'journal',
        [typed]: 'programme',
      });
    });
  });
});
