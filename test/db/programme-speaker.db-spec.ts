import { Harness, startHarness } from './harness';
import { GuestCardsFromHalfTypedNames1912000000000 as M } from '../../src/migrations/1912000000000-GuestCardsFromHalfTypedNames';

/**
 * A guest's name typed into the weekend programme (23 October 2026).
 *
 * The form saves while the name is still being typed. Each partial save went
 * through the mirror, which made a visiting-speaker card from whatever it was
 * given — «Ив» — and linked the slot to it. The rest of the name then arrived
 * as text only: the slot kept the link to «Ив», and so did the visit's place
 * in the brother's history. Found in live data the same day: one programme
 * slot linked to a two-letter card while its text named a real card exactly.
 */
describe('a guest typed into the programme (real database)', () => {
  let h: Harness;
  let week = '';

  /** The Monday n weeks from now. */
  const monday = (weeksAhead: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * weeksAhead);
    const dow = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  };

  async function slotFor(weekStartDate: string): Promise<string> {
    const r = await h.as('admin').post('/assignments', {
      weekStartDate,
      eventType: 'weekend',
      partKey: 'public_talk_speaker',
    });
    expect(r.status).toBe(201);
    return r.body.id;
  }

  /** What the form sends while the brother types: every few letters. */
  async function typeName(slotId: string, ...steps: string[]): Promise<void> {
    for (const speakerName of steps) {
      const r = await h
        .as('admin')
        .patch(`/assignments/${slotId}`, { speakerName });
      expect(r.status).toBe(200);
    }
  }

  const cards = () =>
    h.sql<{ name: string; auto: boolean }>(
      `SELECT concat_ws(' ', first_name, last_name) AS name, auto_created AS auto
         FROM visiting_speakers WHERE deleted_at IS NULL ORDER BY 1`,
    );

  const linkOf = async (slotId: string) => {
    const [row] = await h.sql<{ slot: string | null; entry: string | null }>(
      `SELECT concat_ws(' ', vs.first_name, vs.last_name) AS slot,
              (SELECT concat_ws(' ', v2.first_name, v2.last_name)
                 FROM talk_exchange te JOIN visiting_speakers v2 ON v2.id = te.visiting_speaker_id
                WHERE te.direction = 'incoming' AND te.deleted_at IS NULL
                  AND te.status <> 'did_not_happen'
                  AND te.date BETWEEN a.week_start_date AND a.week_start_date + 6) AS entry
         FROM assignments a LEFT JOIN visiting_speakers vs ON vs.id = a.visiting_speaker_id
        WHERE a.id = $1`,
      [slotId],
    );
    return row;
  };

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    await h.sql(`DELETE FROM talk_exchange`);
    await h.sql(
      `UPDATE assignments SET visiting_speaker_id = NULL, deleted_at = now()`,
    );
    await h.sql(`DELETE FROM visiting_speakers`);
    week = monday(5 + Math.floor(Math.random() * 40));
  });

  it('a new guest typed letter by letter leaves one card, with his whole name', async () => {
    const slot = await slotFor(week);
    await typeName(slot, 'Ив', 'Иван Ро', 'Иван Ротарюк');
    expect(await cards()).toEqual([{ name: 'Иван Ротарюк', auto: true }]);
    expect(await linkOf(slot)).toEqual({
      slot: 'Иван Ротарюк',
      entry: 'Иван Ротарюк',
    });
  });

  it('a guest already in the directory ends on his own card, and nothing extra is left', async () => {
    const own = await h
      .as('admin')
      .post('/visiting-speakers', { firstName: 'Иван', lastName: 'Ротарюк' });
    expect([200, 201]).toContain(own.status);
    const slot = await slotFor(week);
    await typeName(slot, 'Ив', 'Иван Рот', 'Иван Ротарюк');
    expect(await cards()).toEqual([{ name: 'Иван Ротарюк', auto: false }]);
    expect(await linkOf(slot)).toEqual({
      slot: 'Иван Ротарюк',
      entry: 'Иван Ротарюк',
    });
  });

  it('another brother typed over a guest from the directory is not filed under the first', async () => {
    await h
      .as('admin')
      .post('/visiting-speakers', { firstName: 'Иван', lastName: 'Ротарюк' });
    const slot = await slotFor(week);
    await typeName(slot, 'Иван Ротарюк');
    await typeName(slot, 'Петер Кох');
    expect(await linkOf(slot)).toEqual({
      slot: 'Петер Кох',
      entry: 'Петер Кох',
    });
    // Ivan's card stays: it is the coordinator's, not the application's.
    expect((await cards()).map((c) => c.name).sort()).toEqual(
      ['Иван Ротарюк', 'Петер Кох'].sort(),
    );
  });

  it('a card the application made that another week still uses is left alone', async () => {
    const first = await slotFor(week);
    await typeName(first, 'Карл Майер');
    const other = await slotFor(monday(50));
    await typeName(other, 'Ка', 'Карл Майер');
    expect(await cards()).toEqual([{ name: 'Карл Майер', auto: true }]);
    expect((await linkOf(first)).slot).toBe('Карл Майер');
    expect((await linkOf(other)).slot).toBe('Карл Майер');
  });

  it('a card renamed in the directory keeps its visits; the old text is not a new brother', async () => {
    const own = await h
      .as('admin')
      .post('/visiting-speakers', { firstName: 'Иван', lastName: 'Ротарюк' });
    const slot = await slotFor(week);
    await typeName(slot, 'Иван Ротарюк');
    const renamed = await h
      .as('admin')
      .patch(`/visiting-speakers/${own.body.id}`, {
        firstName: 'Iwan',
        lastName: 'Rotariuk',
      });
    expect(renamed.status).toBe(200);
    // Something else on the slot is saved; the name in it is not touched.
    const r = await h
      .as('admin')
      .patch(`/assignments/${slot}`, { partDurationMin: 30 });
    expect(r.status).toBe(200);
    expect(await cards()).toEqual([{ name: 'Iwan Rotariuk', auto: false }]);
    expect(await linkOf(slot)).toEqual({
      slot: 'Iwan Rotariuk',
      entry: 'Iwan Rotariuk',
    });
  });

  it('a guest picked from the directory is that very card, not a namesake', async () => {
    const reda = await h
      .as('admin')
      .post('/external-congregations', { name: 'Реда' });
    const first = await h
      .as('admin')
      .post('/visiting-speakers', { firstName: 'Иван', lastName: 'Ротарюк' });
    const second = await h.as('admin').post('/visiting-speakers', {
      firstName: 'Иван',
      lastName: 'Ротарюк',
      externalCongregationId: reda.body.id,
    });
    expect([200, 201]).toContain(second.status);
    const slot = await slotFor(week);
    const r = await h
      .as('admin')
      .patch(`/assignments/${slot}`, { visitingSpeakerId: second.body.id });
    expect(r.status).toBe(200);
    const [row] = await h.sql<{
      card: string;
      cong: string | null;
      entry: string;
    }>(
      `SELECT a.visiting_speaker_id AS card, a.speaker_congregation AS cong,
              te.visiting_speaker_id AS entry
         FROM assignments a JOIN talk_exchange te ON te.id = a.talk_exchange_id
        WHERE a.id = $1`,
      [slot],
    );
    expect(row).toEqual({
      card: second.body.id,
      cong: 'Реда',
      entry: second.body.id,
    });
    expect(first.body.id).not.toBe(second.body.id);
  });

  it('a card someone added details to is never removed, even if no visit is left on it', async () => {
    const slot = await slotFor(week);
    await typeName(slot, 'Ханс Мюллер');
    const [{ id }] = await h.sql<{ id: string }>(
      `SELECT id FROM visiting_speakers WHERE first_name = 'Ханс'`,
    );
    await h
      .as('admin')
      .patch(`/visiting-speakers/${id}`, { phone: '+49 170 0000000' });
    await typeName(slot, 'Петер Кох');
    expect((await cards()).map((c) => c.name).sort()).toEqual(
      ['Ханс Мюллер', 'Петер Кох'].sort(),
    );
  });
});

describe('the one-time repair of cards from half-typed names (real database)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it('moves each row to the card its text names, and removes only bare, unused cards the application made', async () => {
    const [{ cid }] = await h.sql<{ cid: string }>(
      `SELECT congregation_id AS cid FROM users LIMIT 1`,
    );
    const card = async (
      first: string,
      last: string | null,
      extra: Record<string, unknown> = {},
    ): Promise<string> => {
      const cols = [
        'congregation_id',
        'first_name',
        'last_name',
        ...Object.keys(extra),
      ];
      const vals = [cid, first, last, ...Object.values(extra)];
      const [{ id }] = await h.sql<{ id: string }>(
        `INSERT INTO visiting_speakers (${cols.join(',')})
         VALUES (${vals.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
        vals,
      );
      return id;
    };
    const junk = await card('Ив', null, { auto_created: true });
    const ivan = await card('Иван', 'Ротарюк');
    const orphan = await card('Зигфрид', 'Шмидт', { auto_created: true });
    const withPhone = await card('Юрий', 'Шульц', {
      auto_created: true,
      phone: '+49',
    });
    const merged = await card('Iwan', 'Rotariuk', {
      auto_created: true,
      merged_into_id: ivan,
    });
    const onRemovedRow = await card('Карл', 'Брандт', { auto_created: true });
    const twinJunk = await card('Па', null, { auto_created: true });
    await card('Пауль', 'Майер');
    await card('Пауль', 'Майер');

    const r = await h.as('admin').post('/assignments', {
      weekStartDate: '2027-10-04',
      eventType: 'weekend',
      partKey: 'public_talk_speaker',
    });
    const r2 = await h.as('admin').post('/assignments', {
      weekStartDate: '2027-10-11',
      eventType: 'weekend',
      partKey: 'public_talk_speaker',
    });
    await h.sql(
      `UPDATE assignments SET speaker_name = 'Иван Ротарюк', visiting_speaker_id = $2 WHERE id = $1`,
      [r.body.id, junk],
    );
    await h.sql(
      `UPDATE assignments SET speaker_name = 'Пауль Майер', visiting_speaker_id = $2 WHERE id = $1`,
      [r2.body.id, twinJunk],
    );
    await h.sql(
      `INSERT INTO talk_exchange (congregation_id, direction, date, speaker_name, visiting_speaker_id, deleted_at)
       VALUES ($1, 'incoming', '2026-09-06', 'Карл Брандт', $2, now())`,
      [cid, onRemovedRow],
    );

    const qr = h.db.createQueryRunner();
    await new M().up(qr);
    await new M().up(qr); // twice changes nothing more
    await qr.release();

    const [slot] = await h.sql<{ v: string }>(
      `SELECT visiting_speaker_id AS v FROM assignments WHERE id = $1`,
      [r.body.id],
    );
    expect(slot.v).toBe(ivan);
    const [twin] = await h.sql<{ v: string }>(
      `SELECT visiting_speaker_id AS v FROM assignments WHERE id = $1`,
      [r2.body.id],
    );
    expect(twin.v).toBe(twinJunk);

    const gone = await h.sql<{ id: string }>(
      `SELECT id FROM visiting_speakers WHERE deleted_at IS NOT NULL`,
    );
    expect(gone.map((g) => g.id).sort()).toEqual([junk, orphan].sort());
    for (const kept of [withPhone, merged, onRemovedRow, twinJunk, ivan]) {
      expect(gone.map((g) => g.id)).not.toContain(kept);
    }
  });
});
