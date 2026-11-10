import { Harness, startHarness } from './harness';
import { PairPrepService } from '../../src/pair-prep/pair-prep.service';
import { AssignmentRemindersService } from '../../src/assignment-reminders/assignment-reminders.service';

/**
 * «Договориться о подготовке» on the real database (10 November 2026): a
 * proposal reaches the partner, an answer reaches the proposer, the limits
 * hold, a changed pair forgets, and the evening digest gets its lines.
 */
describe('two people of a part agree when to prepare it (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let svc: PairPrepService;
  let n = 0;

  /** Berlin's today, as the server reckons it. */
  const berlinToday = (): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  const addDays = (iso: string, d: number): string => {
    const x = new Date(`${iso}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + d);
    return x.toISOString().slice(0, 10);
  };
  /** A Monday two or more weeks ahead: everything before it is still to come. */
  const week = (): string => {
    const t = berlinToday();
    const dow = (new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7;
    return addDays(t, 14 - dow + 7 * ++n);
  };

  const person = async (
    login: string,
    first: string,
    last: string,
    withApp = true,
  ) => {
    const card = await h.addPublisher({
      firstName: first,
      lastName: last,
      baptismDate: '2010-01-01',
    });
    const user = withApp
      ? await h.addUser({ login, role: 'publisher', publisherId: card })
      : null;
    return { card, user, login };
  };

  const part = async (w: string, holder: string, helper: string) => {
    const r = await h.as('admin').post('/assignments', {
      weekStartDate: w,
      eventType: 'midweek',
      partKey: 'apply_yourself_1',
      partTitle: 'Начинайте разговор',
      publisherId: holder,
      assistantPublisherId: helper,
    });
    expect(r.status).toBe(201);
    const p = await h.as('admin').post('/assignments/publish', {
      weekStartDate: w,
      eventType: 'midweek',
      notify: false,
    });
    expect([200, 201]).toContain(p.status);
    return r.body.id as string;
  };

  const told = async (userId: string) =>
    (
      await h.sql<{ title: string; body: string; kind: string }>(
        `SELECT title, body, kind FROM notification_outbox
          WHERE user_id = $1 AND kind = 'pair_prep' ORDER BY created_at`,
        [userId],
      )
    ).map((r) => `${r.title} | ${r.body}`);

  const optionsOf = async (login: string, id: string) => {
    const r = await h.as(login).get(`/pair-prep/${id}/options`);
    expect(r.status).toBe(200);
    return r.body as {
      options: { key: string; kind: string }[];
      hidden: { reason: string }[];
    };
  };
  const firstMeeting = async (login: string, id: string) =>
    (await optionsOf(login, id)).options.find((o) => o.kind === 'after')!.key;

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    svc = h.app.get(PairPrepService);
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

  it('a proposal reaches the partner, «подходит» reaches the proposer, both see it agreed', async () => {
    const anna = await person('ppanna', 'Анна', 'Белова');
    const vera = await person('ppvera', 'Вера', 'Гусева');
    const id = await part(week(), anna.card, vera.card);

    const opts = await optionsOf(anna.login, id);
    expect(opts.options.at(-1)!.key).toBe('self');
    expect(opts.options.some((o) => o.kind === 'before')).toBe(true);

    const key = await firstMeeting(anna.login, id);
    const p = await h.as(anna.login).post(`/pair-prep/${id}/propose`, { key });
    expect(p.status).toBe(201);
    expect(p.body.agreement).toMatchObject({
      status: 'proposed',
      proposedByMe: true,
    });

    const veraTold = await told(vera.user!);
    expect(veraTold).toHaveLength(1);
    expect(veraTold[0]).toMatch(/^Начинайте разговор · /);
    expect(veraTold[0]).toContain(
      'Белова Анна предлагает подготовиться вместе: после встречи',
    );

    const mineVera = await h.as(vera.login).get('/pair-prep/mine');
    const item = mineVera.body.find((i: any) => i.assignmentId === id);
    expect(item).toMatchObject({
      partnerName: 'Белова Анна',
      partnerHasApp: true,
      open: true,
      agreement: { status: 'proposed', proposedByMe: false },
    });

    // Only the one it is addressed to may answer.
    const self = await h
      .as(anna.login)
      .post(`/pair-prep/${id}/answer`, { answer: 'agree' });
    expect(self.status).toBe(409);
    expect(self.body.code).toBe('PAIR_PREP_NOTHING_TO_ANSWER');

    const a = await h
      .as(vera.login)
      .post(`/pair-prep/${id}/answer`, { answer: 'agree' });
    expect(a.status).toBe(201);
    expect(a.body.agreement).toMatchObject({
      status: 'agreed',
      proposedByMe: false,
    });
    expect((await told(anna.user!)).at(-1)).toContain(
      'Гусева Вера: подходит — после встречи',
    );

    // A NEW proposal (changing what was agreed) waits until tomorrow.
    const again = await h
      .as(anna.login)
      .post(`/pair-prep/${id}/propose`, { key: 'self' });
    expect(again.status).toBe(429);
    expect(again.body.code).toBe('PAIR_PREP_ONCE_A_DAY');
  }, 30_000);

  it('a counter-proposal is an answer, not a new start; five messages a day at most', async () => {
    const a = await person('ppa2', 'Мария', 'Миронова');
    const b = await person('ppb2', 'Нина', 'Носова');
    const id = await part(week(), a.card, b.card);

    expect(
      (await h.as(a.login).post(`/pair-prep/${id}/propose`, { key: 'self' }))
        .status,
    ).toBe(201);
    // b answers with another time: allowed although a «started» today.
    const key = await firstMeeting(b.login, id);
    const c1 = await h.as(b.login).post(`/pair-prep/${id}/propose`, { key });
    expect(c1.status).toBe(201);
    expect((await told(a.user!)).at(-1)).toContain(
      'Носова Нина предлагает другое время: после встречи',
    );
    expect(
      (await h.as(a.login).post(`/pair-prep/${id}/propose`, { key: 'self' }))
        .status,
    ).toBe(201);
    expect(
      (await h.as(b.login).post(`/pair-prep/${id}/propose`, { key })).status,
    ).toBe(201);
    expect(
      (await h.as(a.login).post(`/pair-prep/${id}/propose`, { key: 'self' }))
        .status,
    ).toBe(201);
    // That was the fifth message of the pair today.
    const sixth = await h
      .as(b.login)
      .post(`/pair-prep/${id}/answer`, { answer: 'decline' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('PAIR_PREP_TOO_MANY');
  }, 30_000);

  it('«не получится» closes it; taking a proposal back does not reopen the day', async () => {
    const a = await person('ppa3', 'Ольга', 'Орлова');
    const b = await person('ppb3', 'Инна', 'Калинина');
    const id = await part(week(), a.card, b.card);
    await h.as(a.login).post(`/pair-prep/${id}/propose`, { key: 'self' });
    const d = await h
      .as(b.login)
      .post(`/pair-prep/${id}/answer`, { answer: 'decline' });
    expect(d.body.agreement.status).toBe('declined');
    expect((await told(a.user!)).at(-1)).toContain(
      'Калинина Инна: не получится в эти дни',
    );

    const id2 = await part(week(), b.card, a.card);
    await h.as(b.login).post(`/pair-prep/${id2}/propose`, { key: 'self' });
    const back = await h.as(b.login).delete(`/pair-prep/${id2}`);
    expect(back.status).toBe(200);
    expect(back.body.agreement).toBeNull();
    const re = await h
      .as(b.login)
      .post(`/pair-prep/${id2}/propose`, { key: 'self' });
    expect(re.status).toBe(429);
  }, 30_000);

  it('no app, no proposal; outsiders are refused; a changed pair forgets', async () => {
    const a = await person('ppa4', 'Зоя', 'Зимина');
    const noApp = await person('ppx4', 'Полина', 'Панова', false);
    const other = await person('ppo4', 'Дарья', 'Ершова');
    const id = await part(week(), a.card, noApp.card);

    const mine = await h.as(a.login).get('/pair-prep/mine');
    expect(
      mine.body.find((i: any) => i.assignmentId === id).partnerHasApp,
    ).toBe(false);
    const p = await h
      .as(a.login)
      .post(`/pair-prep/${id}/propose`, { key: 'self' });
    expect(p.status).toBe(409);
    expect(p.body.code).toBe('PAIR_PREP_NO_APP');

    const out = await h.as(other.login).get(`/pair-prep/${id}/options`);
    expect(out.status).toBe(403);
    expect(out.body.code).toBe('PAIR_PREP_NOT_YOURS');

    // With a partner who has the app, then the partner changed.
    const patch1 = await h
      .as('admin')
      .patch(`/assignments/${id}`, { assistantPublisherId: other.card });
    expect(patch1.status).toBe(200);
    await h.as('admin').post('/assignments/publish', {
      weekStartDate: (
        await h.sql<{ w: string }>(
          `SELECT to_char(week_start_date,'YYYY-MM-DD') w FROM assignments WHERE id=$1`,
          [id],
        )
      )[0].w,
      eventType: 'midweek',
      notify: false,
    });
    expect(
      (await h.as(a.login).post(`/pair-prep/${id}/propose`, { key: 'self' }))
        .status,
    ).toBe(201);
    await h
      .as('admin')
      .patch(`/assignments/${id}`, { assistantPublisherId: noApp.card });
    const after = await h.as(a.login).get('/pair-prep/mine');
    expect(
      after.body.find((i: any) => i.assignmentId === id).agreement,
    ).toBeNull();
    expect(
      (
        await h.sql(`SELECT 1 FROM pair_agreements WHERE assignment_id = $1`, [
          id,
        ])
      ).length,
    ).toBe(0);
  }, 30_000);

  it('a partner’s duty is left out and named', async () => {
    const a = await person('ppa5', 'Вера', 'Гусева-Два');
    const b = await person('ppb5', 'Галина', 'Данилова');
    const w = week();
    const id = await part(w, a.card, b.card);
    const before = await optionsOf(a.login, id);
    const first = before.options.find((o) => o.kind === 'after')!.key;
    const [, date, kind] = first.split(':');
    const dutyWeek = addDays(
      date,
      -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7),
    );
    await h.sql(
      `INSERT INTO duties (congregation_id, week_start_date, event_type, duty_type, slot_index, publisher_id)
       VALUES ($1, $2, $3, 'attendant', 0, $4)`,
      [tenantId, dutyWeek, kind, b.card],
    );
    const after = await optionsOf(a.login, id);
    expect(after.options.map((o) => o.key)).not.toContain(first);
    expect(after.hidden.map((x) => x.reason)).toContain('partner_duty');
  }, 30_000);

  it('the evening: tomorrow’s agreed preparation to both, a waiting proposal once to its addressee; the past is deleted', async () => {
    const a = await person('ppa6', 'Екатерина', 'Жукова');
    const b = await person('ppb6', 'Лариса', 'Ломоносова');
    const c = await person('ppc6', 'Инна', 'Иванова');
    const id = await part(week(), a.card, b.card);
    const id2 = await part(week(), c.card, a.card);
    const today = berlinToday();

    await h.as(a.login).post(`/pair-prep/${id}/propose`, {
      key: await firstMeeting(a.login, id),
    });
    await h.as(b.login).post(`/pair-prep/${id}/answer`, { answer: 'agree' });
    await h.sql(
      `UPDATE pair_agreements SET option_date = $2 WHERE assignment_id = $1`,
      [id, addDays(today, 1)],
    );

    await h.as(c.login).post(`/pair-prep/${id2}/propose`, { key: 'self' });
    await h.sql(
      `UPDATE pair_agreements SET proposed_at = now() - interval '1 day' WHERE assignment_id = $1`,
      [id2],
    );

    // Made today: not yet a «waiting» line tonight.
    const d = await person('ppd6', 'Нина', 'Новикова');
    const id3 = await part(week(), d.card, b.card);
    await h.as(d.login).post(`/pair-prep/${id3}/propose`, { key: 'self' });

    const lines = await svc.eveningLines(tenantId, today);
    expect(lines.get(a.user!)?.('ru')).toEqual([
      expect.stringMatching(
        /^Завтра — подготовка к «Начинайте разговор» в паре: после встречи/,
      ),
      'Ждёт вашего ответа: Иванова Инна предлагает подготовиться к «Начинайте разговор».',
    ]);
    expect(lines.get(b.user!)?.('ru')).toHaveLength(1);
    expect(lines.get(c.user!)).toBeUndefined();

    // And the digest itself carries them — the reminders' own evening pass.
    await h.app.get(AssignmentRemindersService).sendDigests(tenantId, today);
    const evening = await h.sql<{ title: string; body: string }>(
      `SELECT title, body FROM notification_outbox
        WHERE user_id = $1 AND kind = 'assignment_reminder'`,
      [b.user],
    );
    expect(evening).toHaveLength(1);
    expect(evening[0].body).toContain(
      'Завтра — подготовка к «Начинайте разговор» в паре',
    );

    // The day after the meeting the row is gone.
    await h.sql(
      `UPDATE pair_agreements SET meeting_date = $2 WHERE assignment_id = $1`,
      [id, addDays(today, -1)],
    );
    await svc.prune(tenantId, today);
    expect(
      (
        await h.sql(`SELECT 1 FROM pair_agreements WHERE assignment_id = $1`, [
          id,
        ])
      ).length,
    ).toBe(0);
  }, 30_000);
});
