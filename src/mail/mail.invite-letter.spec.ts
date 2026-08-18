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
