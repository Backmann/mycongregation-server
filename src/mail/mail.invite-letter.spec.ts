import { MailService } from './mail.service';

/**
 * What the letter says, in the case that made all of this necessary.
 *
 * A husband and wife with one mailbox receive two invitations. Until now both
 * began «Здравствуйте!» and carried nothing but a code — indistinguishable,
 * and neither told the reader what to type at the sign-in screen.
 */
describe('the invitation letter', () => {
  const build = () => {
    const sent: { html: string; text: string; to: string }[] = [];
    const service = Object.create(MailService.prototype) as MailService;
    Object.assign(service, {
      logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn() },
      deliver: (to: string, _subject: string, html: string, text: string) => {
        sent.push({ to, html, text });
        return Promise.resolve(true);
      },
    });
    return { service, sent };
  };

  it('greets the reader by name and shows the name to sign in with', async () => {
    const { service, sent } = build();

    await service.sendInvite('family@gmail.com', 'ru', 'https://x/y', {
      code: 'K7QM-3XPD',
      recipientName: 'Вера',
      loginName: 'sidorova.vera',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain('Здравствуйте, Вера!');
    expect(sent[0].html).toContain('sidorova.vera');
    // The plain-text part is not an afterthought: some clients show only it.
    expect(sent[0].text).toContain('Здравствуйте, Вера!');
    expect(sent[0].text).toContain('sidorova.vera');
  });

  it('falls back to a nameless hello when no card stands behind the account', async () => {
    const { service, sent } = build();

    await service.sendInvite('admin@example.org', 'ru', 'https://x/y', {
      code: 'K7QM-3XPD',
    });

    expect(sent[0].html).toContain('Здравствуйте!');
    expect(sent[0].html).not.toContain('{{name}}');
  });

  it('never leaves the placeholder in the German letter either', async () => {
    const { service, sent } = build();

    await service.sendInvite('vera@example.org', 'de', 'https://x/y', {
      recipientName: 'Vera',
      loginName: 'sidorova.vera',
    });

    expect(sent[0].html).toContain('Hallo, Vera!');
    expect(sent[0].html).not.toContain('{{name}}');
  });

  /**
   * The order of a letter is not decoration: a person does things in the
   * order they are told them. Open the app — and what «the app» is on this
   * device — then the code, then what to keep.
   */
  it('goes in the order a person acts: where the app is, the code, the name', async () => {
    const { service, sent } = build();

    await service.sendInvite(
      'vera@gmail.com',
      'ru',
      'https://mycongregation.org/reset-password?code=K7QM-3XPD',
      {
        code: 'K7QM-3XPD',
        loginName: 'sidorova.vera',
        installUrl: 'https://mycongregation.org/app/',
        recipientName: 'Вера',
      },
    );

    for (const body of [sent[0].text, sent[0].html]) {
      const at = (x: string) => {
        const i = body.indexOf(x);
        expect(i).toBeGreaterThan(-1);
        return i;
      };
      expect(at('Шаг 1')).toBeLessThan(at('mycongregation.org/app/'));
      expect(at('mycongregation.org/app/')).toBeLessThan(at('Шаг 2'));
      expect(at('Шаг 2')).toBeLessThan(at('K7QM-3XPD'));
      expect(at('K7QM-3XPD')).toBeLessThan(at('sidorova.vera'));
    }
  });

  it('says what «the app» is on an Android phone, an iPhone and a computer', async () => {
    // People use it three ways, and «откройте приложение» meant nothing to
    // somebody whose app is an icon on an iPhone's Home Screen.
    const { service, sent } = build();

    await service.sendInvite('vera@gmail.com', 'ru', '', {
      code: 'K7QM-3XPD',
      installUrl: 'https://mycongregation.org/app/',
    });

    expect(sent[0].text).toMatch(/Android/);
    expect(sent[0].text).toMatch(/iPhone/);
    expect(sent[0].text).toMatch(/компьютер/i);
    expect(sent[0].text).toContain('На каждом устройстве входят отдельно');
  });

  it('carries no link that signs anybody in, and says so about its button', async () => {
    const { service, sent } = build();

    await service.sendInvite(
      'vera@gmail.com',
      'ru',
      'https://mycongregation.org/reset-password?code=K7QM-3XPD',
      { code: 'K7QM-3XPD' },
    );

    for (const body of [sent[0].text, sent[0].html]) {
      expect(body).not.toMatch(/token=/);
      expect(body).toContain('только вписывает код');
      expect(body).not.toMatch(
        /Читаете с компьютера|72 часа|общий почтовый ящик/,
      );
    }
  });

  it('does not say «вводите имя, а не адрес» — the address works too', async () => {
    // The sign-in field is labelled «Имя входа или почта» and takes either;
    // the letter contradicted it.
    const { service, sent } = build();

    await service.sendInvite('vera@gmail.com', 'ru', '', {
      code: 'K7QM-3XPD',
      loginName: 'sidorova.vera',
    });

    expect(sent[0].text).not.toMatch(/не адрес почты/);
    expect(sent[0].text).toContain('Адрес почты тоже подойдёт');
  });

  it('names the congregation the invitation comes from', async () => {
    // A letter from an unfamiliar domain asking somebody to set a password is
    // indistinguishable from a trick unless it says whose it is.
    const { service, sent } = build();

    await service.sendInvite('vera@gmail.com', 'ru', 'https://x/y', {
      code: 'K7QM-3XPD',
      congregationName: 'Хамм',
    });

    expect(sent[0].html).toContain('Хамм');
    expect(sent[0].text).toContain('Хамм');
  });

  it('says the deadline as a day, not as a timestamp', async () => {
    // «06.10.2026, 12:00» was a machine format with a precision to the minute
    // for something that lives a month — and the hour came from the server's
    // clock, not the congregation's, so it was not even true.
    const { service, sent } = build();

    await service.sendInvite('vera@gmail.com', 'ru', 'https://x/y', {
      code: 'K7QM-3XPD',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    expect(sent[0].text).toMatch(
      /Код действует до \d{1,2} (января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/,
    );
    expect(sent[0].text).not.toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(sent[0].text).not.toMatch(/\d{2}:\d{2}/);
  });

  it('names somebody to turn to when it does not work', async () => {
    // The last word used to be «this message is automatic», which leaves a
    // reader whose code was refused with nowhere at all to go.
    const { service, sent } = build();

    await service.sendInvite('vera@gmail.com', 'ru', 'https://x/y', {
      code: 'K7QM-3XPD',
    });

    expect(sent[0].text).toContain('кто вас пригласил');
    expect(sent[0].html).toContain('кто вас пригласил');
  });

  it('leaves a line in the log for every letter that goes out', async () => {
    // An empty log used to mean two different things — «nothing was sent» and
    // «sending is not recorded» — and the first time somebody asked which one
    // it was, there was no way to tell. The address and subject only: the body
    // carries names, codes and links.
    const log = jest.fn();
    const service = Object.create(MailService.prototype) as MailService;
    Object.assign(service, {
      logger: { warn: jest.fn(), log, error: jest.fn() },
      from: 'noreply@mycongregation.org',
      transporter: { sendMail: jest.fn(async () => undefined) },
    });

    await service.sendInvite('vera@gmail.com', 'ru', 'https://x/y', {
      code: 'K7QM-3XPD',
    });

    const line = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(line).toContain('vera@gmail.com');
    expect(line).not.toContain('K7QM-3XPD');
  });

  describe('«Забыли пароль»', () => {
    const send = async (extra: Record<string, unknown> = {}) => {
      const { service, sent } = build();
      await service.sendPasswordReset(
        'family@gmail.com',
        'ru',
        'https://mycongregation.org/reset-password?code=K7QM-3XPD',
        {
          code: 'K7QM-3XPD',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          recipientName: 'Александр',
          loginName: 'sidorov.aleksandr',
          ...extra,
        },
      );
      return sent[0];
    };

    it('is a code letter: two steps, the code, «сутки» — and no sign-in link', async () => {
      // It used to say «перейдите по ссылке:» and follow that with the login
      // name; the link itself stood under «Читаете с компьютера?».
      const letter = await send();
      for (const body of [letter.text, letter.html]) {
        expect(body).toContain('Шаг 1');
        expect(body).toContain('У меня есть код');
        expect(body).toContain('K7QM-3XPD');
        expect(body).toContain('Код действует сутки');
        expect(body).not.toMatch(
          /token=|перейдите по ссылке|Читаете с компьютера|1 час/,
        );
      }
    });

    it('says which name is which — two such letters may share a mailbox', async () => {
      const letter = await send();
      expect(letter.html).toContain('Здравствуйте, Александр!');
      expect(letter.html).toContain('sidorov.aleksandr');
    });

    it('«вы попросили» for the person’s own request, «вам выдали код» for an elder’s', async () => {
      expect((await send()).text).toContain('Вы попросили восстановить пароль');
      const byElder = (await send({ issuedByElder: true })).text;
      expect(byElder).toContain('Вам выдали код');
      expect(byElder).not.toContain('Вы попросили');
      expect(byElder).not.toContain('Если вы не запрашивали');
    });
  });

  it('«вам задали пароль» is a plain notice: no steps, no «читаете с компьютера»', async () => {
    const { service, sent } = build();

    await service.sendPasswordSetByAdmin('vera@gmail.com', 'ru', {
      recipientName: 'Вера',
      loginName: 'sidorova.vera',
    });

    expect(sent[0].text).toContain('sidorova.vera');
    expect(sent[0].text).not.toMatch(/Читаете с компьютера|Шаг 1/);
    expect(sent[0].text).not.toMatch(/\n\n\n/);
  });
});
