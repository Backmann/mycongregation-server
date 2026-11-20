import { Harness, startHarness } from './harness';

/**
 * The midweek meeting's guidelines on the server (Lionel, 20 November 2026):
 * a part is refused to someone the guidelines do not give it to — whatever
 * screen sends it — but a part that already has its people can still be
 * edited, since the rule must not lock what it did not write.
 */
describe('midweek guidelines on saving a part (real database)', () => {
  let h: Harness;
  let sister = '';
  let sister2 = '';
  let brother = '';
  let servant = '';
  let student = '';
  let n = 0;

  const monday = (): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * (8 + 2 * ++n));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const post = (body: Record<string, unknown>) =>
    h.as('admin').post('/assignments', { eventType: 'midweek', ...body });

  beforeAll(async () => {
    h = await startHarness();
    sister = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Тест',
      gender: 'sister',
      baptismDate: '2001-01-01',
    });
    sister2 = await h.addPublisher({
      firstName: 'Вера',
      lastName: 'Тест',
      gender: 'sister',
      baptismDate: '2001-01-01',
    });
    brother = await h.addPublisher({
      firstName: 'Иван',
      lastName: 'Тест',
      baptismDate: '2001-01-01',
    });
    servant = await h.addPublisher({
      firstName: 'Пётр',
      lastName: 'Тест',
      baptismDate: '2001-01-01',
      appointment: 'ministerial_servant',
    });
    student = await h.addPublisher({
      firstName: 'Олег',
      lastName: 'Тест',
      appointment: 'student',
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('Bible reading is refused to a sister, given to a brother', async () => {
    const week = monday();
    const no = await post({
      weekStartDate: week,
      partKey: 'bible_reading',
      publisherId: sister,
    });
    expect(no.status).toBe(400);
    expect(no.body.code).toBe('PART_NEEDS_BROTHER');
    const ok = await post({
      weekStartDate: week,
      partKey: 'bible_reading',
      publisherId: brother,
    });
    expect(ok.status).toBe(201);
  });

  it('the weekend chairman and a prayer: a brother only, on both meetings', async () => {
    const week = monday();
    for (const [eventType, partKey] of [
      ['weekend', 'weekend_chairman'],
      ['weekend', 'watchtower_reader'],
      ['midweek', 'midweek_closing_prayer'],
    ]) {
      const no = await h.as('admin').post('/assignments', {
        weekStartDate: week,
        eventType,
        partKey,
        publisherId: sister,
      });
      expect(no.status).toBe(400);
      expect(no.body.code).toBe('PART_NEEDS_BROTHER');
      const ok = await h.as('admin').post('/assignments', {
        weekStartDate: week,
        eventType,
        partKey,
        publisherId: brother,
      });
      expect(ok.status).toBe(201);
    }
  });

  it('«Развивайте интерес»: the assistant of the other gender is refused', async () => {
    const week = monday();
    const r = await post({
      weekStartDate: week,
      partKey: 'apply_yourself_2',
      partTitle: 'Развивайте интерес',
      publisherId: sister,
      assistantPublisherId: brother,
    });
    expect(r.body.code).toBe('ASSISTANT_SAME_GENDER');
    const ok = await post({
      weekStartDate: week,
      partKey: 'apply_yourself_2',
      partTitle: 'Развивайте интерес',
      publisherId: sister,
      assistantPublisherId: sister2,
    });
    expect(ok.status).toBe(201);
  });

  it('«Начинайте разговор»: one of the family may assist — allowed', async () => {
    const r = await post({
      weekStartDate: monday(),
      partKey: 'apply_yourself_1',
      partTitle: 'Начинайте разговор',
      publisherId: sister,
      assistantPublisherId: brother,
    });
    expect(r.status).toBe(201);
  });

  it('a part already held is still editable; a new person is checked', async () => {
    const week = monday();
    const made = await post({
      weekStartDate: week,
      partKey: 'bible_reading',
      publisherId: brother,
    });
    expect(made.status).toBe(201);
    // As if set before the rules: a sister already on the part.
    await h.sql(`UPDATE assignments SET publisher_id = $1 WHERE id = $2`, [
      sister,
      made.body.id,
    ]);
    const note = await h
      .as('admin')
      .patch(`/assignments/${made.body.id}`, { notes: 'время' });
    expect(note.status).toBe(200);
    const swap = await h
      .as('admin')
      .patch(`/assignments/${made.body.id}`, { publisherId: sister2 });
    expect(swap.status).toBe(400);
    expect(swap.body.code).toBe('PART_NEEDS_BROTHER');
  });

  it('Christian life: a publisher is refused, a servant given it', async () => {
    const week = monday();
    const no = await post({
      weekStartDate: week,
      partKey: 'living_christians_1',
      partTitle: 'Тема',
      publisherId: brother,
    });
    expect(no.body.code).toBe('PART_NEEDS_ELDER_OR_SERVANT');
    const ok = await post({
      weekStartDate: week,
      partKey: 'living_christians_1',
      partTitle: 'Тема',
      publisherId: servant,
    });
    expect(ok.status).toBe(201);
    const ln = await post({
      weekStartDate: week,
      partKey: 'living_christians_2',
      partTitle: 'Местные потребности',
      publisherId: servant,
    });
    expect(ln.body.code).toBe('PART_NEEDS_ELDER');
  });

  it('a student without the mark of the part is refused, with it allowed', async () => {
    const week = monday();
    const no = await post({
      weekStartDate: week,
      partKey: 'bible_reading',
      publisherId: student,
    });
    expect(no.body.code).toBe('STUDENT_NOT_APPROVED');
    await h.sql(
      `UPDATE publishers SET capabilities = '{"bible_reading": true}' WHERE id = $1`,
      [student],
    );
    const ok = await post({
      weekStartDate: week,
      partKey: 'bible_reading',
      publisherId: student,
    });
    expect(ok.status).toBe(201);
  });

  it('the local-needs speaker is an elder', async () => {
    const r = await h.as('admin').post('/local-needs', {
      title: 'Тема собрания',
      speakerPublisherId: servant,
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PART_NEEDS_ELDER');
  });

  it('a part that becomes another part is asked about its people', async () => {
    const week = monday();
    const made = await post({
      weekStartDate: week,
      partKey: 'apply_yourself_1',
      partTitle: 'Начинайте разговор',
      publisherId: sister,
    });
    expect(made.status).toBe(201);
    const r = await h
      .as('admin')
      .patch(`/assignments/${made.body.id}`, { partKey: 'bible_reading' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PART_NEEDS_BROTHER');
  });

  it('a part holding a local-needs topic: an elder only, also after it is placed', async () => {
    const elder = await h.addPublisher({
      firstName: 'Борис',
      lastName: 'Тест',
      baptismDate: '1990-01-01',
      appointment: 'elder',
    });
    const week = monday();
    const part = await post({
      weekStartDate: week,
      partKey: 'living_christians_1',
      partTitle: 'Тема',
    });
    expect(part.status).toBe(201);
    const topic = await h.as('admin').post('/local-needs', {
      title: 'Местная тема',
      speakerPublisherId: elder,
    });
    expect(topic.status).toBe(201);
    const placed = await h
      .as('admin')
      .post(`/local-needs/${topic.body.id}/place`, {
        weekStartDate: week,
        assignmentId: part.body.id,
      });
    expect([200, 201]).toContain(placed.status);
    // The part now carries the topic's title — the binding still tells it.
    const swap = await h
      .as('admin')
      .patch(`/assignments/${part.body.id}`, { publisherId: servant });
    expect(swap.status).toBe(400);
    expect(swap.body.code).toBe('PART_NEEDS_ELDER');
  });

  it('a topic is not placed on a part a servant already holds', async () => {
    const week = monday();
    const part = await post({
      weekStartDate: week,
      partKey: 'living_christians_1',
      partTitle: 'Тема',
      publisherId: servant,
    });
    expect(part.status).toBe(201);
    const topic = await h
      .as('admin')
      .post('/local-needs', { title: 'Ещё тема' });
    expect(topic.status).toBe(201);
    const placed = await h
      .as('admin')
      .post(`/local-needs/${topic.body.id}/place`, {
        weekStartDate: week,
        assignmentId: part.body.id,
      });
    expect(placed.status).toBe(400);
    expect(placed.body.code).toBe('PART_NEEDS_ELDER');
  });

  it('the opening prayer does not mirror a publisher onto the Treasures talk', async () => {
    const week = monday();
    // The link is the congregation's own choice; it is on here.
    await h.sql(
      `UPDATE congregations SET assignment_automation_enabled = true`,
    );
    const treasures = await post({
      weekStartDate: week,
      partKey: 'treasures_talk',
    });
    expect(treasures.status).toBe(201);
    await h.sql(
      `UPDATE publishers SET capabilities = '{"treasures_talk": true, "midweek_opening_prayer": true}' WHERE id = $1`,
      [brother],
    );
    const prayer = await post({
      weekStartDate: week,
      partKey: 'midweek_opening_prayer',
      publisherId: brother,
    });
    expect(prayer.status).toBe(201);
    const row = await h.sql<{ p: string | null }>(
      `SELECT publisher_id AS p FROM assignments WHERE id = $1`,
      [treasures.body.id],
    );
    expect(row[0].p).toBeNull();
  });
});
