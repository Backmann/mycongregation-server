import { Harness, startHarness } from './harness';

/**
 * The people side of the 23 October 2026 sync audit, against a real database.
 * Each case is the sequence that was reproduced on the stand that day.
 */
describe('people: departure, sign-in, pioneer spells (real database)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  describe('a departed elder', () => {
    let cardId: string;
    let userId: string;

    beforeAll(async () => {
      cardId = await h.addPublisher({
        firstName: 'Андреас',
        lastName: 'Келлер',
        appointment: 'elder',
        baptismDate: '2001-05-12',
      });
      userId = await h.addUser({
        login: 'keller',
        role: 'elder',
        publisherId: cardId,
      });
      for (const type of ['secretary', 'service_overseer']) {
        const r = await h
          .as('admin')
          .post('/responsibilities', { type, userId });
        expect([200, 201]).toContain(r.status);
      }
      // He is signed in on a device before he leaves.
      const me = await h.as('keller').get('/auth/me');
      expect(me.status).toBe(200);
    });

    it('the window is told what leaves with him', async () => {
      const r = await h.as('admin').get(`/publishers/${cardId}/removal-impact`);
      expect(r.status).toBe(200);
      expect(r.body.account).toMatchObject({
        active: true,
        role: 'elder',
        closable: true,
      });
      expect([...r.body.responsibilities].sort()).toEqual([
        'secretary',
        'service_overseer',
      ]);
    });

    it('loses his responsibilities and, when asked, his sign-in — all at once', async () => {
      const r = await h.as('admin').post(`/publishers/${cardId}/remove`, {
        reason: 'moved',
        closeAccount: true,
      });
      expect([200, 201]).toContain(r.status);

      const [card] = await h.sql<{ gone: boolean }>(
        `SELECT deleted_at IS NOT NULL AS gone FROM publishers WHERE id = $1`,
        [cardId],
      );
      expect(card.gone).toBe(true);
      const held = await h.sql(
        `SELECT 1 FROM responsibilities WHERE user_id = $1`,
        [userId],
      );
      expect(held).toHaveLength(0);
      const [user] = await h.sql<{ is_active: boolean }>(
        `SELECT is_active FROM users WHERE id = $1`,
        [userId],
      );
      expect(user.is_active).toBe(false);
      const sessions = await h.sql(
        `SELECT 1 FROM refresh_sessions WHERE user_id = $1`,
        [userId],
      );
      expect(sessions).toHaveLength(0);
    });

    it('can no longer sign in', async () => {
      const res = await h.as(null).post('/auth/login', {
        login: 'keller',
        password: 'Db-Test-Pass-9xQ!',
      });
      expect(res.status).toBe(401);
    });

    it('his sign-in can be moved to another card without a server error, and takes that card’s role', async () => {
      const other = await h.addPublisher({
        firstName: 'Андреас',
        lastName: 'Келлер-2',
      });
      const r = await h
        .as('admin')
        .patch(`/users/${userId}/publisher`, { publisherId: other });
      expect(r.status).toBe(200);
      const [user] = await h.sql<{ role: string }>(
        `SELECT role FROM users WHERE id = $1`,
        [userId],
      );
      expect(user.role).toBe('publisher');
      const [old] = await h.sql<{ user_id: string | null }>(
        `SELECT user_id FROM publishers WHERE id = $1`,
        [cardId],
      );
      expect(old.user_id).toBeNull();
    });
  });

  it('a departure without the box keeps the sign-in but still takes the responsibilities', async () => {
    const card = await h.addPublisher({
      firstName: 'Марк',
      lastName: 'Фогт',
      appointment: 'ministerial_servant',
      baptismDate: '2010-03-01',
    });
    const userId = await h.addUser({
      login: 'fogt',
      role: 'ministerial_servant',
      publisherId: card,
    });
    await h
      .as('admin')
      .post('/responsibilities', { type: 'attendant_overseer', userId });
    const r = await h
      .as('admin')
      .post(`/publishers/${card}/remove`, { reason: 'other' });
    expect([200, 201]).toContain(r.status);
    const [user] = await h.sql<{ is_active: boolean }>(
      `SELECT is_active FROM users WHERE id = $1`,
      [userId],
    );
    expect(user.is_active).toBe(true);
    expect(
      await h.sql(`SELECT 1 FROM responsibilities WHERE user_id = $1`, [
        userId,
      ]),
    ).toHaveLength(0);
  });

  describe('pioneer spells follow the card', () => {
    it('a card made as a regular pioneer has its spell at once', async () => {
      const id = await h.addPublisher({
        firstName: 'Тест',
        lastName: 'Пионеров',
        baptismDate: '2015-01-01',
        pioneerType: 'regular',
        pioneerSince: '2025-09-01',
      });
      const spells = await h.sql<{
        pioneer_type: string;
        start_month: string;
        end_month: string | null;
      }>(
        `SELECT pioneer_type, to_char(start_month,'YYYY-MM-DD') AS start_month, end_month
           FROM pioneer_spells WHERE publisher_id = $1`,
        [id],
      );
      expect(spells).toEqual([
        { pioneer_type: 'regular', start_month: '2025-09-01', end_month: null },
      ]);
    });

    it('changing the kind with the old date is refused, and nothing is rewritten', async () => {
      const id = await h.addPublisher({
        firstName: 'Юрген',
        lastName: 'Беккер',
        baptismDate: '2000-01-01',
        pioneerType: 'regular',
        pioneerSince: '2024-09-01',
      });
      const r = await h.as('admin').patch(`/publishers/${id}`, {
        pioneerType: 'special',
        pioneerSince: '2024-09-01',
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('PIONEER_KIND_CHANGE_DATE');
      const [card] = await h.sql<{ pioneer_type: string }>(
        `SELECT pioneer_type FROM publishers WHERE id = $1`,
        [id],
      );
      expect(card.pioneer_type).toBe('regular');
      const spells = await h.sql(
        `SELECT 1 FROM pioneer_spells WHERE publisher_id = $1`,
        [id],
      );
      expect(spells).toHaveLength(1);
    });

    it('changing the kind from a later month keeps the past as it was', async () => {
      const id = await h.addPublisher({
        firstName: 'Кай',
        lastName: 'Брандт',
        baptismDate: '2000-01-01',
        pioneerType: 'regular',
        pioneerSince: '2024-09-01',
      });
      const r = await h.as('admin').patch(`/publishers/${id}`, {
        pioneerType: 'special',
        pioneerSince: '2026-11-01',
      });
      expect(r.status).toBe(200);
      const spells = await h.sql<{ k: string; s: string; e: string | null }>(
        `SELECT pioneer_type AS k, to_char(start_month,'YYYY-MM') AS s, to_char(end_month,'YYYY-MM') AS e
           FROM pioneer_spells WHERE publisher_id = $1 ORDER BY start_month`,
        [id],
      );
      expect(spells).toEqual([
        { k: 'regular', s: '2024-09', e: '2026-10' },
        { k: 'special', s: '2026-11', e: null },
      ]);
    });

    it('«the kind was wrong all along» corrects the open spell without splitting it', async () => {
      const id = await h.addPublisher({
        firstName: 'Пауль',
        lastName: 'Майер',
        baptismDate: '2000-01-01',
        pioneerType: 'regular',
        pioneerSince: '2024-09-01',
      });
      const r = await h
        .as('admin')
        .post(`/publishers/${id}/pioneer-kind-correction`, {
          pioneerType: 'special',
        });
      expect(r.status).toBe(200);
      const spells = await h.sql<{ k: string; s: string; e: string | null }>(
        `SELECT pioneer_type AS k, to_char(start_month,'YYYY-MM') AS s, end_month AS e
           FROM pioneer_spells WHERE publisher_id = $1`,
        [id],
      );
      expect(spells).toEqual([{ k: 'special', s: '2024-09', e: null }]);
    });
  });
});
