#!/usr/bin/env node
/**
 * A small invented congregation for the app's screen checks.
 *
 *   node scripts/seed-screens.mjs [http://localhost:3000/api]
 *
 * The app's CI starts this server against an empty database, runs this
 * script, and photographs the same screens with the main branch and with the
 * pull request. Everything goes through the public API, as a person in the
 * app would do it, so the data passes the server's own validation and keeps
 * working when tables change.
 *
 * SAFE BY CONSTRUCTION. It refuses any address that is not this computer, and
 * it starts with the bootstrap call, which the server accepts only on a
 * database without users. Pointed at a live server, it stops before writing
 * anything.
 *
 * DATES. The server freezes past meetings by the real clock, so the programme
 * is built on weeks that are still ahead for it: the Monday after next is
 * "the browser's current week" (CI freezes the browser clock on its Tuesday,
 * 10:00), with one week before it and two after. A run on any day of the week
 * produces the same picture.
 *
 * HARD CASES on purpose: a very long programme title, a double surname, a
 * note on a part, pairs, a moved meeting, a visiting speaker, a failure in the
 * journal. Easy data hides the layouts that break.
 *
 * Invented names and addresses only. Logins and the password are for the
 * throwaway database of a check and mean nothing anywhere else.
 */

const API = (
  process.argv[2] ||
  process.env.SEED_API ||
  'http://localhost:3000/api'
).replace(/\/$/, '');
const PASSWORD = 'Screens-Check-2026!';
export const LOGINS = {
  admin: 'admin@example.invalid',
  publisher: 'publisher',
  // Anna's partner in the current week: she proposes a time to prepare.
  partner: 'partner',
};

const host = new URL(API).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  console.error(
    `seed-screens: refusing ${host} — only a server on this computer.`,
  );
  process.exit(2);
}

let token = null;
async function call(
  method,
  path,
  body,
  { as = token, ok = [200, 201, 204] } = {},
) {
  let res;
  // The server's rate limit is kept as it is in production: on 429 the
  // script waits as long as the server asks and tries again.
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(as ? { authorization: `Bearer ${as}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status !== 429 || attempt >= 20) break;
    await res.text();
    const wait = Number(res.headers.get('retry-after')) || 5;
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!ok.includes(res.status)) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 600)}`);
  }
  return data;
}
const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b);
const patch = (p, b) => call('PATCH', p, b);
const put = (p, b) => call('PUT', p, b);

// ── dates, in the congregation's zone ──────────────────────────────────
const ZONE = 'Europe/Berlin';
function todayInZone() {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return new Date(`${s}T00:00:00Z`);
}
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
function mondayOf(d) {
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(d, -dow);
}
const realMonday = mondayOf(todayInZone());
/** The browser's "current week": the Monday after next. */
export const CURRENT = addDays(realMonday, 14);
const WEEKS = [-1, 0, 1, 2].map((k) => addDays(CURRENT, 7 * k));

// ── people ─────────────────────────────────────────────────────────────
// [first, last, gender, appointment, extra]
const PEOPLE = [
  ['Андрей', 'Ветров', 'brother', 'elder', { admin: true }],
  ['Борис', 'Лаптев', 'brother', 'elder'],
  ['Виктор', 'Озеров', 'brother', 'elder'],
  ['Глеб', 'Румянцев', 'brother', 'ministerial_servant'],
  ['Денис', 'Сафонов', 'brother', 'ministerial_servant'],
  ['Егор', 'Тихонов', 'brother', 'ministerial_servant'],
  ['Захар', 'Уваров', 'brother', 'publisher', { pioneer: true }],
  ['Илья', 'Фомин', 'brother', 'publisher'],
  ['Кирилл', 'Харитонов', 'brother', 'publisher'],
  ['Лев', 'Цветков', 'brother', 'publisher'],
  ['Матвей', 'Шубин', 'brother', 'publisher'],
  ['Никита', 'Щукин', 'brother', 'unbaptized_publisher'],
  ['Анна', 'Белова', 'sister', 'publisher', { login: true }],
  ['Вера', 'Гусева', 'sister', 'publisher'],
  ['Галина', 'Данилова', 'sister', 'publisher', { pioneer: true }],
  ['Дарья', 'Ершова', 'sister', 'publisher'],
  ['Екатерина', 'Жукова', 'sister', 'publisher'],
  ['Зоя', 'Зимина', 'sister', 'publisher'],
  ['Инна', 'Калинина', 'sister', 'publisher'],
  ['Лариса', 'Ломоносова-Преображенская', 'sister', 'publisher'],
  ['Мария', 'Миронова', 'sister', 'publisher'],
  ['Нина', 'Носова', 'sister', 'publisher'],
  ['Ольга', 'Орлова', 'sister', 'publisher'],
  ['Полина', 'Панова', 'sister', 'unbaptized_publisher'],
];

// ── programme of a week (titles invented, as on the stand) ─────────────
function midweekParts(n) {
  const long =
    n === 2
      ? 'Тестовая речь недели с очень длинным названием, которое не помещается в одну строку ни на телефоне, ни на широком экране'
      : `Тестовая речь недели ${n}`;
  return [
    ['midweek_chairman', 0, 'Председатель'],
    [
      'midweek_opening_prayer',
      2,
      `Песня ${40 + n} и молитва | Вступительные слова`,
    ],
    ['treasures_talk', 3, long, 10],
    ['spiritual_gems', 4, 'Духовные жемчужины', 10],
    ['bible_reading', 5, 'Чтение Библии', 4],
    ['apply_yourself_1', 6, 'Начинайте разговор', 3],
    ['apply_yourself_2', 7, 'Развивайте интерес', 4],
    ['apply_yourself_3', 8, 'Речь', 5],
    ['mid_song', 9, `Песня ${120 + n}`],
    ['living_christians_1', 10, `Тестовый пункт христианской жизни ${n}`, 15],
    ['cbs_conductor', 13, 'Изучение Библии в собрании', 30],
    ['cbs_reader', 14, 'Чтец'],
    ['midweek_closing_prayer', 15, `Песня ${140 + n} и молитва`],
  ].map(([partKey, partOrder, partTitle, partDurationMin]) => ({
    partKey,
    partOrder,
    partTitle,
    ...(partDurationMin ? { partDurationMin } : {}),
  }));
}
function weekendParts(n) {
  return [
    ['weekend_chairman', 0, ''],
    ['weekend_opening_prayer', 1, `Песня ${30 + n} и молитва`],
    ['public_talk_speaker', 2, `Тестовая тема публичной речи ${n}`, 30],
    ['weekend_song', 3, `Песня ${60 + n}`],
    ['watchtower_conductor', 4, `Тестовая статья для изучения ${n}`, 60],
    ['watchtower_reader', 5, ''],
    ['weekend_closing_prayer', 6, `Песня ${150 + n} и молитва`],
  ].map(([partKey, partOrder, partTitle, partDurationMin]) => ({
    partKey,
    partOrder,
    ...(partTitle ? { partTitle } : {}),
    ...(partDurationMin ? { partDurationMin } : {}),
  }));
}

async function main() {
  // 1. The congregation. Fails on any database that already has users.
  try {
    await call(
      'POST',
      '/auth/bootstrap',
      {
        congregationName: 'Тестовое собрание',
        country: 'DE',
        language: 'ru',
        timezone: ZONE,
        email: LOGINS.admin,
        password: PASSWORD,
      },
      { as: null, ok: [201] },
    );
  } catch (e) {
    console.error(
      `seed-screens: bootstrap refused — the database is not empty, nothing written.\n${e.message}`,
    );
    process.exit(3);
  }
  token = (
    await call(
      'POST',
      '/auth/login',
      { login: LOGINS.admin, password: PASSWORD },
      { as: null },
    )
  ).accessToken;

  await post('/meeting-settings', {
    effectiveFrom: iso(WEEKS[0]),
    midweekDow: 3,
    midweekTime: '19:00',
    weekendDow: 7,
    weekendTime: '10:00',
    address: 'Примерная улица 1, 12345 Примерный город',
    microphoneSlots: 2,
  });

  // 2. Groups and people.
  const groups = [];
  for (const name of ['Группа 1', 'Группа 2', 'Группа 3']) {
    groups.push(
      (await post('/service-groups', { name, meetingLocation: 'Зал Царства' }))
        .id,
    );
  }
  const ids = [];
  for (const [
    i,
    [firstName, lastName, gender, appointment, extra = {}],
  ] of PEOPLE.entries()) {
    const p = await post('/publishers', {
      firstName,
      lastName,
      gender,
      appointment,
      serviceGroupId: groups[i % 3],
      capabilities: {
        ...(gender === 'brother' && appointment !== 'unbaptized_publisher'
          ? { midweek_opening_prayer: true, weekend_opening_prayer: true }
          : {}),
        ...(['Андрей', 'Захар', 'Галина'].includes(firstName)
          ? { fs_meeting_conductor: true }
          : {}),
      },
      ...(extra.pioneer
        ? { pioneerType: 'regular', pioneerSince: '2020-09-01' }
        : {}),
    });
    ids.push(p.id);
  }
  const byName = (first) => ids[PEOPLE.findIndex((p) => p[0] === first)];

  // The administrator's own card; the publisher's login.
  const me = await get('/auth/me').catch(() => get('/me'));
  const adminUserId = me.id ?? me.user?.id;
  await patch(`/users/${adminUserId}/publisher`, {
    publisherId: byName('Андрей'),
  });
  await post('/users', {
    loginName: LOGINS.publisher,
    password: PASSWORD,
    role: 'publisher',
    publisherId: byName('Анна'),
  });
  await post('/users', {
    loginName: LOGINS.partner,
    password: PASSWORD,
    role: 'publisher',
    publisherId: byName('Вера'),
  });

  // 3. The programme, through the same import the workbook uses.
  // The import decides the meeting of a week from its parts, so the two
  // meetings go in separate calls.
  for (const parts of [midweekParts, weekendParts]) {
    await post('/mwb-import/apply', {
      weeks: WEEKS.map((w, k) => ({
        weekStartDate: iso(w),
        weekEndDate: iso(addDays(w, 6)),
        biblePassage: `Тестовая книга ${k + 1}–${k + 2}`,
        parts: parts(k + 1),
      })),
    });
  }

  // 4. Who does what. Index k: 0 = the week before, 1 = current, 2, 3.
  const P = byName;
  // The talk catalogue is empty on a new database: eight invented outlines,
  // one of them with a title long enough to need two lines everywhere.
  const talkList = [];
  for (let n = 1; n <= 8; n++) {
    talkList.push(
      await post('/public-talks', {
        number: n,
        title:
          n === 4
            ? 'Тестовая тема публичной речи с длинным названием, которое занимает несколько строк на любом экране'
            : `Тестовая тема публичной речи ${n}`,
      }),
    );
  }
  const ext = await post('/external-congregations', {
    name: 'Соседнее собрание',
    city: 'Соседний город',
  });
  const guest = await post('/visiting-speakers', {
    firstName: 'Павел',
    lastName: 'Гостев',
    externalCongregationId: ext.id,
    talkNumbers: [talkList[3].number],
  });
  const plan = [
    // midweek
    {
      chairman: 'Борис',
      open: 'Глеб',
      treasures: 'Виктор',
      gems: 'Денис',
      reading: 'Илья',
      a1: ['Мария', 'Нина'],
      a2: ['Ольга', 'Инна'],
      a3: 'Кирилл',
      life: 'Андрей',
      cbs: 'Борис',
      reader: 'Егор',
      close: 'Захар',
      wChair: 'Виктор',
      wOpen: 'Лев',
      speaker: { own: 'Борис', talk: 1 },
      wt: 'Андрей',
      wtReader: 'Денис',
      wClose: 'Матвей',
    },
    {
      chairman: 'Андрей',
      open: 'Егор',
      treasures: 'Борис',
      gems: 'Глеб',
      reading: 'Лев',
      a1: [
        'Анна',
        'Вера',
        'Подготовить вопрос для начала разговора и короткий стих',
      ],
      a2: ['Галина', 'Лариса'],
      a3: 'Матвей',
      life: 'Виктор',
      cbs: 'Андрей',
      reader: 'Денис',
      close: 'Илья',
      wChair: 'Борис',
      wOpen: 'Захар',
      speaker: { guest: true, talk: 3 },
      wt: 'Виктор',
      wtReader: 'Глеб',
      wClose: 'Кирилл',
    },
    {
      chairman: 'Виктор',
      open: 'Денис',
      treasures: 'Андрей',
      gems: 'Егор',
      reading: 'Кирилл',
      a1: ['Зоя', 'Екатерина'],
      a2: ['Дарья', 'Анна'],
      a3: 'Илья',
      life: 'Борис',
      cbs: 'Виктор',
      reader: 'Глеб',
      close: 'Лев',
      wChair: 'Андрей',
      wOpen: 'Матвей',
      speaker: { own: 'Виктор', talk: 5 },
      wt: 'Борис',
      wtReader: 'Егор',
      wClose: 'Захар',
    },
    {
      chairman: 'Борис',
      open: 'Глеб',
      treasures: 'Виктор',
      gems: 'Денис',
      reading: 'Матвей',
      a1: ['Вера', 'Ольга'],
      a2: ['Мария', 'Зоя'],
      a3: 'Лев',
      life: 'Андрей',
      cbs: 'Борис',
      reader: 'Егор',
      close: 'Кирилл',
      wChair: 'Виктор',
      wOpen: 'Илья',
      speaker: { own: 'Андрей', talk: 7 },
      wt: 'Андрей',
      wtReader: 'Денис',
      wClose: 'Лев',
    },
  ];
  const keyOf = {
    midweek_chairman: 'chairman',
    midweek_opening_prayer: 'open',
    treasures_talk: 'treasures',
    spiritual_gems: 'gems',
    bible_reading: 'reading',
    apply_yourself_1: 'a1',
    apply_yourself_2: 'a2',
    apply_yourself_3: 'a3',
    living_christians_1: 'life',
    cbs_conductor: 'cbs',
    cbs_reader: 'reader',
    midweek_closing_prayer: 'close',
    weekend_chairman: 'wChair',
    weekend_opening_prayer: 'wOpen',
    watchtower_conductor: 'wt',
    watchtower_reader: 'wtReader',
    weekend_closing_prayer: 'wClose',
  };
  for (const [k, w] of WEEKS.entries()) {
    const rows = await get(
      `/assignments?weekStart=${iso(w)}&weekEnd=${iso(addDays(w, 6))}&limit=100`,
    );
    const list = Array.isArray(rows) ? rows : (rows.items ?? rows.data);
    for (const r of list) {
      const who = plan[k][keyOf[r.partKey]];
      if (r.partKey === 'public_talk_speaker') {
        const sp = plan[k].speaker;
        const talk = talkList[sp.talk];
        await patch(
          `/assignments/${r.id}`,
          sp.guest
            ? { visitingSpeakerId: guest.id, publicTalkId: talk.id }
            : { publisherId: P(sp.own), publicTalkId: talk.id },
        );
        continue;
      }
      if (!who) continue;
      const [main, helper, note] = Array.isArray(who) ? who : [who];
      await patch(`/assignments/${r.id}`, {
        publisherId: P(main),
        ...(helper ? { assistantPublisherId: P(helper) } : {}),
        ...(note ? { notes: note } : {}),
      });
    }
    for (const eventType of ['midweek', 'weekend']) {
      await post('/assignments/publish', {
        weekStartDate: iso(w),
        eventType,
        notify: false,
      });
    }
  }

  // 5. A moved meeting: the midweek meeting of the week after "current" goes
  //    to Thursday — Home shows it with the moved mark.
  await put(`/meeting-moves/${iso(WEEKS[2])}/midweek`, {
    date: iso(addDays(WEEKS[2], 3)),
    time: '19:00',
  });

  // 6. Duties at the meetings, cleaning, field service meetings.
  const dutyPeople = [
    'Глеб',
    'Денис',
    'Егор',
    'Захар',
    'Илья',
    'Кирилл',
    'Лев',
    'Матвей',
  ];
  let d = 0;
  for (const w of WEEKS) {
    for (const eventType of ['midweek', 'weekend']) {
      const made = await post('/duties/generate', {
        weekStartDate: iso(w),
        eventType,
      });
      const duties = Array.isArray(made)
        ? made
        : (made?.items ?? made?.duties ?? []);
      for (const duty of duties) {
        await patch(`/duties/${duty.id}/assign`, {
          publisherId: P(dutyPeople[d++ % dutyPeople.length]),
        });
      }
    }
    await put('/cleaning', {
      weekStartDate: iso(w),
      slotType: 'after_meeting',
      serviceGroupId: groups[WEEKS.indexOf(w) % 3],
    });
    for (const [dayOfWeek, startTime, who, topic] of [
      [2, '10:00', 'Захар', 'Как предложить изучение Библии'],
      [6, '09:30', 'Андрей', 'Как начать разговор с соседом'],
      [6, '11:00', 'Галина', null],
    ]) {
      await post('/field-service-meetings', {
        weekStartDate: iso(w),
        dayOfWeek,
        startTime,
        address: 'Зал Царства',
        conductorPublisherId: P(who),
        ...(topic ? { topic } : {}),
        notifyConductor: false,
      });
    }
  }

  // 6⅛. Events for the invited only (10 November 2026): the school for
  //     elders on the Saturday of the week after next (Андрей is an elder:
  //     the admin sees it, Anna does not), the pioneers' special meeting six
  //     weeks on (Захар and Галина are pioneers), and a convention for all.
  await post('/special-events', {
    title: 'Школа царственного служения для старейшин',
    type: 'kingdom_ministry_school_elders',
    date: iso(addDays(WEEKS[3], 5)),
    endDate: iso(addDays(WEEKS[3], 6)),
    time: '09:30',
    timeEnd: '16:00',
    address: 'Зал конгрессов',
  });
  await post('/special-events', {
    title: 'Специальная встреча с пионерами района',
    type: 'pioneer_special_meeting',
    date: iso(addDays(WEEKS[3], 40)),
    time: '09:30',
    address: 'Зал конгрессов',
  });
  await post('/special-events', {
    title: 'Региональный конгресс',
    type: 'regional_convention',
    date: iso(addDays(WEEKS[3], 75)),
    endDate: iso(addDays(WEEKS[3], 77)),
    time: '09:30',
    address: 'Конгресс-холл',
  });

  // 6¼. A service overseer's visit: Андрей (Группа 1) visits Группа 2 on a
  //     Friday at 10:30, and the congregation has a combined meeting that
  //     morning at 09:00 — next week (Home's two weeks: both rows, the
  //     combined one with the hour of his visit) and the week after (beyond
  //     them: the visit's row names the combined meeting).
  for (const w of [WEEKS[2], WEEKS[3]]) {
    await post('/field-service-meetings', {
      weekStartDate: iso(w),
      dayOfWeek: 5,
      startTime: '09:00',
      address: 'Зал Царства',
      isGeneral: true,
      conductorPublisherId: P('Захар'),
      topic: 'Как рассказать о надежде тому, кто горюет',
      notifyConductor: false,
    });
    await post('/field-service-meetings', {
      weekStartDate: iso(w),
      dayOfWeek: 5,
      startTime: '10:30',
      address: 'Зал Царства',
      serviceGroupId: groups[1],
      serviceOverseerVisit: true,
      serviceOverseerPublisherId: P('Андрей'),
      conductorPublisherId: P('Андрей'),
      notifyConductor: false,
    });
  }

  // 6½. «Договориться о подготовке»: Вера, Anna's partner in the current
  //     week, proposes a last check before the meeting — Anna's card shows it with
  //     the answers. Anna's part a week later is with Дарья, who has no
  //     login: that card says to arrange it in person.
  const adminToken = token;
  token = (
    await call(
      'POST',
      '/auth/login',
      { login: LOGINS.partner, password: PASSWORD },
      { as: null },
    )
  ).accessToken;
  const mine = await get('/pair-prep/mine');
  const withAnna = mine.find((i) => i.partnerName === 'Белова Анна');
  if (withAnna) {
    const { options } = await get(
      `/pair-prep/${withAnna.assignmentId}/options`,
    );
    // «Before» the part's own meeting: the server offers moments by the real
    // clock, and the screens freeze the browser on the part's week — this is
    // the one moment that reads right on both.
    const pick = options.find((o) => o.kind === 'before') ?? options[0];
    await post(`/pair-prep/${withAnna.assignmentId}/propose`, {
      key: pick.key,
    });
  }
  token = adminToken;

  // 6¾. Territories (11 November 2026): an invented boundary and six
  //     invented squares far from anywhere real, brought over the way the
  //     import does it, confirmed, then one given out. Anna holds one of
  //     her own and walks a group one held by Захар; one is overdue, two
  //     have been free for more than a year. Dates count from the real today:
  //     the server judges by it, not by the browser's frozen clock.
  {
    const today = todayInZone();
    const day = (n) => iso(addDays(today, n));
    const square = (col, row) => {
      const x = 10.0 + col * 0.012;
      const y = 51.0 + row * 0.008;
      return {
        type: 'Polygon',
        coordinates: [
          [
            [x, y],
            [x + 0.011, y],
            [x + 0.011, y + 0.007],
            [x, y + 0.007],
            [x, y],
          ],
        ],
      };
    };
    await post('/territories/import/boundary', {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [9.995, 50.995],
            [10.04, 50.995],
            [10.04, 51.02],
            [9.995, 51.02],
            [9.995, 50.995],
          ],
        ],
      },
      description: { north: 'Примерная улица', south: 'Полевая дорога' },
    });
    await post('/territories/import/territories', {
      items: [
        ['T01', 'Примерный город', 0, 0],
        ['T02', 'Примерный город', 1, 0],
        ['T03', 'Примерный город', 2, 0],
        ['T04', 'Посёлок', 0, 1],
        ['T05', 'Посёлок', 1, 1],
        ['T06', 'Посёлок', 2, 1],
      ].map(([number, locality, col, row]) => ({
        number,
        locality,
        geometry: square(col, row),
      })),
    });
    await post('/territories/import/assignments', {
      items: [
        // Held for 150 days: past its four months.
        {
          number: 'T03',
          holderName: 'Озеров Виктор',
          publisherId: P('Виктор'),
          assignedOn: day(-150),
        },
        // A group territory, ten days before it is due.
        {
          number: 'T02',
          holderName: 'Уваров Захар',
          publisherId: P('Захар'),
          forGroupId: groups[0],
          assignedOn: day(-110),
        },
        // Worked 14 months ago: free for more than a year.
        {
          number: 'T04',
          holderName: 'Лаптев Борис',
          publisherId: P('Борис'),
          assignedOn: day(-500),
          completedOn: day(-420),
        },
        // Worked two months ago.
        {
          number: 'T05',
          holderName: 'Гусева Вера',
          publisherId: P('Вера'),
          assignedOn: day(-100),
          completedOn: day(-60),
        },
      ],
    });
    await post('/territories/import/no-calls', {
      items: [
        {
          number: 'T01',
          address: 'Примерная улица 12, 2 этаж',
          notedOn: day(-30),
        },
        { number: 'T01', address: 'Полевая дорога 3', notedOn: day(-200) },
      ],
    });
    await call('POST', '/territories/verify', undefined, { ok: [200] });
    const list = await get('/territories');
    const id = (n) => list.find((t) => t.number === n).id;
    // Given out today: a day in the past may fall into the previous
    // service year, which only the import may write.
    await post(`/territories/${id('T01')}/assign`, {
      publisherId: P('Анна'),
    });
  }

  // 7. Two kinds of failure in the journal, so its screen is not empty.
  for (const message of [
    "TypeError: Cannot read properties of undefined (reading 'title')",
    'Error: Network request failed',
  ]) {
    await call(
      'POST',
      '/client-errors',
      {
        platform: 'web',
        source: 'uncaught',
        route: '/schedule',
        message,
        role: 'publisher',
      },
      { as: null },
    );
  }

  console.log(
    JSON.stringify({
      current: iso(CURRENT),
      weeks: WEEKS.map(iso),
      logins: LOGINS,
    }),
  );
}

main().catch((e) => {
  console.error(`seed-screens: ${e.message}`);
  process.exit(1);
});
