import { MailService } from './mail.service';

/**
 * A letter that lands in somebody else's mailbox must not carry a way in.
 *
 * The link signs in whoever clicks it — that is exactly what makes it useful
 * at a computer, and exactly what makes it dangerous in a shared inbox. A
 * husband opening his wife's invitation would set HER password and find
 * himself inside HER account. A code cannot do that: it has to be typed on the
 * phone of the person it belongs to.
 */
describe('an invitation sent to a borrowed mailbox', () => {
  const build = () => {
    const sent: { html: string; text: string }[] = [];
    const service = Object.create(MailService.prototype) as MailService;
    Object.assign(service, {
      logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn() },
      deliver: (_to: string, _subject: string, html: string, text: string) => {
        sent.push({ html, text });
        return Promise.resolve(true);
      },
    });
    return { service, sent };
  };

  it('carries no link at all', async () => {
    const { service, sent } = build();

    await service.sendInvite('family@gmail.com', 'ru', '', {
      code: 'K7QM-3XPD',
      recipientName: 'Вера',
      loginName: 'sidorova.vera',
      borrowedMailbox: true,
    });

    expect(sent[0].html).not.toContain('reset-password?token=');
    // Neither as a button nor as the bare address printed underneath.
    expect(sent[0].html).not.toContain('<a href="https://');
    expect(sent[0].text).not.toContain('reset-password');
  });

  it('asks whoever opened it to pass the code on', async () => {
    const { service, sent } = build();

    await service.sendInvite('family@gmail.com', 'ru', '', {
      code: 'K7QM-3XPD',
      recipientName: 'Вера',
      borrowedMailbox: true,
    });

    // The name at the top and this line together answer «whose is this?»
    expect(sent[0].html).toContain('Здравствуйте, Вера!');
    expect(sent[0].html).toContain('общий почтовый ящик');
    expect(sent[0].text).toContain('общий почтовый ящик');
  });

  it('still carries the code and the login name', async () => {
    // Stripping the link must not strip the letter's whole purpose.
    const { service, sent } = build();

    await service.sendInvite('family@gmail.com', 'ru', '', {
      code: 'K7QM-3XPD',
      recipientName: 'Вера',
      loginName: 'sidorova.vera',
      borrowedMailbox: true,
    });

    expect(sent[0].html).toContain('K7QM-3XPD');
    expect(sent[0].html).toContain('sidorova.vera');
  });

  it('leaves the link in place for somebody\u2019s own address', async () => {
    const { service, sent } = build();

    await service.sendInvite('vera@gmail.com', 'ru', 'https://x/y?token=abc', {
      code: 'K7QM-3XPD',
      recipientName: 'Вера',
      loginName: 'sidorova.vera',
    });

    expect(sent[0].html).toContain('https://x/y?token=abc');
    expect(sent[0].text).toContain('https://x/y?token=abc');
  });
});
