import { Harness, startHarness } from './harness';
import { TalkAttentionService } from '../../src/talk-exchange/talk-attention.service';

/**
 * A trip of ours is a promise to another congregation (Lionel, 23 October
 * 2026): taking the brother off must not lose it, and those who answer for
 * the exchange must hear about it.
 */
describe('trips «От нас» without a brother (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let hostId: string;
  let brotherCard: string;
  let coordinatorUser: string;

  const inDays = (n: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    const host = await h
      .as('admin')
      .post('/external-congregations', { name: 'Падерборн' });
    expect([200, 201]).toContain(host.status);
    hostId = host.body.id;
    brotherCard = await h.addPublisher({
      firstName: 'Тимо',
      lastName: 'Ланг',
      appointment: 'ministerial_servant',
      baptismDate: '2012-01-01',
    });
    await h.addUser({
      login: 'lang',
      role: 'ministerial_servant',
      publisherId: brotherCard,
    });
    const coordCard = await h.addPublisher({
      firstName: 'Давид',
      lastName: 'Келлер',
      appointment: 'elder',
      baptismDate: '2000-01-01',
    });
    coordinatorUser = await h.addUser({
      login: 'coord',
      role: 'elder',
      publisherId: coordCard,
    });
    const r = await h.as('admin').post('/responsibilities', {
      type: 'public_talk_coordinator',
      userId: coordinatorUser,
    });
    expect([200, 201]).toContain(r.status);
  });
  afterAll(async () => {
    await h?.close();
  });

  const attentionNotices = (entryId: string) =>
    h.sql<{ user_id: string; key: string }>(
      `SELECT user_id, dedupe_key AS key FROM notification_outbox
        WHERE kind = 'talk_exchange_attention' AND data->>'entryId' = $1`,
      [entryId],
    );

  it('taking the brother off keeps the trip and tells the coordinators', async () => {
    const trip = await h.as('coord').post('/talk-exchange', {
      direction: 'outgoing',
      date: inDays(20),
      publisherId: brotherCard,
      hostCongregationId: hostId,
    });
    expect(trip.status).toBe(201);
    const off = await h
      .as('coord')
      .patch(`/talk-exchange/${trip.body.id}`, { publisherId: null });
    expect(off.status).toBe(200);

    const [row] = await h.sql<{ gone: boolean; publisher_id: string | null }>(
      `SELECT deleted_at IS NOT NULL AS gone, publisher_id FROM talk_exchange WHERE id = $1`,
      [trip.body.id],
    );
    expect(row).toEqual({ gone: false, publisher_id: null });

    const told = await attentionNotices(trip.body.id);
    expect(told.map((t) => t.user_id)).toContain(coordinatorUser);

    const list = await h.as('coord').get('/talk-exchange/attention');
    expect(list.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: trip.body.id, reason: 'needs_brother' }),
      ]),
    );
  });

  it('reminds 14 days before, once, however often the daily pass runs', async () => {
    const trip = await h.as('coord').post('/talk-exchange', {
      direction: 'outgoing',
      date: inDays(10),
      hostCongregationId: hostId,
    });
    expect(trip.status).toBe(201);
    const svc = h.app.get(TalkAttentionService);
    await svc.runFor(tenantId);
    await svc.runFor(tenantId);
    const keys = (await attentionNotices(trip.body.id)).map((t) => t.key);
    const fourteen = keys.filter((k) => k.endsWith(':14'));
    expect(fourteen.length).toBeGreaterThan(0);
    // One per recipient, not one per pass.
    expect(new Set(fourteen).size).toBe(1);
    expect(keys.filter((k) => k.endsWith(':7'))).toHaveLength(0);
  });

  it('a brother away that day puts the trip in question until someone says he goes', async () => {
    const date = inDays(30);
    const trip = await h.as('coord').post('/talk-exchange', {
      direction: 'outgoing',
      date,
      publisherId: brotherCard,
      hostCongregationId: hostId,
    });
    const away = await h.as('admin').post('/absences', {
      publisherId: brotherCard,
      startDate: inDays(29),
      endDate: inDays(31),
    });
    expect([200, 201]).toContain(away.status);

    const before = await h.as('coord').get('/talk-exchange/attention');
    expect(before.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: trip.body.id, reason: 'absence' }),
      ]),
    );
    const ack = await h
      .as('coord')
      .post(`/talk-exchange/${trip.body.id}/attention-ack`, {
        reason: 'absence',
      });
    expect(ack.status).toBe(200);
    const after = await h.as('coord').get('/talk-exchange/attention');
    expect(after.body.map((x: { id: string }) => x.id)).not.toContain(
      trip.body.id,
    );
  });

  it('a trip that did not happen leaves the brother no absence', async () => {
    const trip = await h.as('coord').post('/talk-exchange', {
      direction: 'outgoing',
      date: inDays(40),
      publisherId: brotherCard,
      hostCongregationId: hostId,
    });
    const [{ n: had }] = await h.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM absences WHERE talk_exchange_id = $1 AND deleted_at IS NULL`,
      [trip.body.id],
    );
    expect(had).toBe(1);
    const r = await h
      .as('coord')
      .patch(`/talk-exchange/${trip.body.id}`, { status: 'did_not_happen' });
    expect(r.status).toBe(200);
    const [{ n }] = await h.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM absences WHERE talk_exchange_id = $1 AND deleted_at IS NULL`,
      [trip.body.id],
    );
    expect(n).toBe(0);
  });

  it('the body coordinator may keep the journal and is told; his assistant is neither', async () => {
    const bcoCard = await h.addPublisher({
      firstName: 'Андреас',
      lastName: 'Вебер',
      appointment: 'elder',
      baptismDate: '1995-01-01',
    });
    const bco = await h.addUser({
      login: 'bco',
      role: 'elder',
      publisherId: bcoCard,
    });
    await h
      .as('admin')
      .post('/responsibilities', { type: 'body_coordinator', userId: bco });
    const asstCard = await h.addPublisher({
      firstName: 'Юрген',
      lastName: 'Шмидт',
      appointment: 'elder',
      baptismDate: '1998-01-01',
    });
    const asst = await h.addUser({
      login: 'bcoasst',
      role: 'elder',
      publisherId: asstCard,
    });
    await h.as('admin').post('/responsibilities', {
      type: 'body_coordinator_assistant',
      userId: asst,
    });

    const trip = await h.as('bco').post('/talk-exchange', {
      direction: 'outgoing',
      date: inDays(25),
      publisherId: brotherCard,
      hostCongregationId: hostId,
    });
    expect(trip.status).toBe(201);
    expect(
      (
        await h
          .as('bcoasst')
          .patch(`/talk-exchange/${trip.body.id}`, { note: 'x' })
      ).status,
    ).toBe(403);
    const off = await h
      .as('bco')
      .patch(`/talk-exchange/${trip.body.id}`, { publisherId: null });
    expect(off.status).toBe(200);
    const told = (await attentionNotices(trip.body.id)).map((t) => t.user_id);
    expect(told).toContain(bco);
    expect(told).not.toContain(asst);
  });
});
