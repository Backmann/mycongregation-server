import { Harness, startHarness } from './harness';
import { AssignmentsService } from '../../src/assignments/assignments.service';

/**
 * A part done by two, on the real database (9 November 2026): each half is
 * told the other's name, the record of «сказано» keeps whom he was told of,
 * and a changed pair is said as a new helper — through the API an editor
 * uses, the publish, and the column the migration adds.
 */
describe('a part done by two: who is told whom (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let svc: AssignmentsService;
  let n = 0;

  // Far from the other specs' weeks, and far from today: no «через 2 дня».
  const monday = (): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * (40 + 2 * ++n));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };

  const sister = async (login: string, first: string, last: string) => {
    const card = await h.addPublisher({
      firstName: first,
      lastName: last,
      baptismDate: '2010-01-01',
    });
    const user = await h.addUser({
      login,
      role: 'publisher',
      publisherId: card,
    });
    return { card, user };
  };

  const settle = () => new Promise((r) => setTimeout(r, 400));
  const bodies = async (userId: string) =>
    (
      await h.sql<{ body: string }>(
        `SELECT body FROM notification_outbox WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      )
    ).map((r) => r.body);
  const marks = (itemId: string) =>
    h.sql<{ user_id: string; partner: string | null; known: boolean }>(
      `SELECT user_id, partner_publisher_id AS partner, partner_known AS known
         FROM assignment_notices WHERE item_id = $1 ORDER BY assistant`,
      [itemId],
    );

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    svc = h.app.get(AssignmentsService);
    const settings = await h.as('admin').post('/meeting-settings', {
      effectiveFrom: '2026-01-05',
      midweekDow: 3,
      midweekTime: '19:00',
      weekendDow: 7,
      weekendTime: '10:00',
      address: 'Musterstraße 1, 59065 Hamm',
      confirmPast: true,
    });
    expect([200, 201]).toContain(settings.status);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('published: both halves named, and whom each was told of is on record', async () => {
    const week = monday();
    const julia = await sister('pair1', 'Юлия', 'Урбан');
    const vika = await sister('pair2', 'Виктория', 'Кох');
    const olesya = await sister('pair3', 'Олеся', 'Рупп');

    const r = await h.as('admin').post('/assignments', {
      weekStartDate: week,
      eventType: 'midweek',
      partKey: 'apply_yourself_1',
      partTitle: 'Начинайте разговор: ПРОПОВЕДЬ ВЕЗДЕ. Расскажите о надежде.',
      publisherId: julia.card,
      assistantPublisherId: vika.card,
    });
    expect(r.status).toBe(201);
    const id = r.body.id as string;
    const p = await h.as('admin').post('/assignments/publish', {
      weekStartDate: week,
      eventType: 'midweek',
      notify: true,
    });
    expect([200, 201]).toContain(p.status);
    await settle();

    expect((await bodies(julia.user)).at(-1)).toContain(
      'Начинайте разговор (помощник: Кох Виктория)',
    );
    expect((await bodies(vika.user)).at(-1)).toContain(
      'Начинайте разговор (помощник, в паре: Урбан Юлия)',
    );
    expect(await marks(id)).toEqual([
      { user_id: julia.user, partner: vika.card, known: true },
      { user_id: vika.user, partner: julia.card, known: true },
    ]);

    // The helper replaced: a new helper to Юлия, and the record follows.
    // Past the ten seconds in which a second press is read as a double tap.
    await new Promise((r) => setTimeout(r, 10_500));
    const patch = await h
      .as('admin')
      .patch(`/assignments/${id}`, { assistantPublisherId: olesya.card });
    expect(patch.status).toBe(200);
    await svc.notifyChanges(tenantId, week, 'midweek' as never);
    await settle();

    expect((await bodies(julia.user)).at(-1)).toContain(
      '(новый помощник: Рупп Олеся)',
    );
    expect((await bodies(olesya.user)).at(-1)).toContain(
      '(помощник, в паре: Урбан Юлия)',
    );
    const after = await marks(id);
    expect(after.find((m) => m.user_id === julia.user)?.partner).toBe(
      olesya.card,
    );
    expect(after.some((m) => m.user_id === vika.user)).toBe(false);
  }, 30_000);
});
