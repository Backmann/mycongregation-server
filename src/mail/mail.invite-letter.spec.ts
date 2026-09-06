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
   * The order of a letter is not decoration. What a person reads first is what
   * they act on, and the two things this letter exists to hand over — the code
   * and the name to sign in with — used to sit third and last, behind a button
   * about installing the app.
   */
  it('puts the code and the login name ahead of the install page', async () => {
    const { service, sent } = build();

    await service.sendInvite('vera@gmail.com', 'ru', 'https://x/y', {
      code: 'K7QM-3XPD',
      loginName: 'sidorova.vera',
      installUrl: 'https://mycongregation.org/app/',
      recipientName: 'Вера',
    });

    const text = sent[0].text;
    expect(text.indexOf('K7QM-3XPD')).toBeLessThan(
      text.indexOf('mycongregation.org/app/'),
    );
    expect(text.indexOf('sidorova.vera')).toBeLessThan(
      text.indexOf('mycongregation.org/app/'),
    );
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
      expiresAt: new Date('2026-10-06T12:00:00Z'),
    });

    expect(sent[0].text).toContain('6 октября');
    expect(sent[0].text).not.toContain('06.10.2026');
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

  it('says which name is which in a reset letter too', async () => {
    // Two reset letters in one mailbox is the likelier of the two cases: both
    // of them forgot, and each needs to know which is theirs.
    const { service, sent } = build();

    await service.sendPasswordReset('family@gmail.com', 'ru', 'https://x/y', {
      recipientName: 'Александр',
      loginName: 'sidorov.aleksandr',
    });

    expect(sent[0].html).toContain('Здравствуйте, Александр!');
    expect(sent[0].html).toContain('sidorov.aleksandr');
  });
});
