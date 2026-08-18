// The push module reaches expo-server-sdk, which ships ESM that Jest will not
// parse. Nothing here touches push; stubbing it keeps the import graph quiet.
jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { PublishersService } from './publishers.service';

/**
 * Writing the delivery address onto the publisher's card.
 *
 * Useful, and deliberately not automatic. The card's address is a private
 * field the elders read as «how to reach this person»; an address borrowed for
 * one delivery is not that. So the elder says whether it belongs there, and
 * these hold the two rules that follow from it.
 */
describe('PublishersService.grantAccess — the card address', () => {
  const build = (cardEmail: string | null) => {
    const publisher = {
      id: 'p1',
      congregationId: 'c1',
      userId: null as string | null,
      email: cardEmail,
      firstName: 'Вера',
      lastName: 'Сидорова',
      appointment: 'publisher',
      contactsConfirmedAt: null as Date | null,
      lastEditedById: null as string | null,
    };
    const save = jest.fn(async (x: unknown) => x);
    const service = Object.create(
      PublishersService.prototype,
    ) as PublishersService;
    Object.assign(service, {
      publishersRepo: { save },
      findOne: jest.fn(async () => publisher),
      getAccess: jest.fn(async () => ({ hasAccess: true })),
      usersService: {
        createUserByAdmin: jest.fn(async () => ({
          id: 'u1',
          invitation: undefined,
        })),
        suggestLoginName: () => 'sidorova.vera',
      },
    });
    return { service, publisher, save };
  };

  const grant = (service: PublishersService, dto: Record<string, unknown>) =>
    (
      service as unknown as {
        grantAccess: (
          t: string,
          id: string,
          dto: Record<string, unknown>,
          actor: { id: string },
        ) => Promise<unknown>;
      }
    ).grantAccess('c1', 'p1', dto, { id: 'admin-1' });

  it('writes the address to an empty card when the elder asks', async () => {
    const { service, publisher } = build(null);

    await grant(service, {
      email: 'vera@gmail.com',
      sendInvite: true,
      saveEmailToCard: true,
    });

    expect(publisher.email).toBe('vera@gmail.com');
  });

  it('does not mark the contacts as confirmed', async () => {
    // The yearly check asks whether the PERSON confirmed their details. An
    // address typed by an elder to deliver a code answers nothing of the sort.
    const { service, publisher } = build(null);

    await grant(service, {
      email: 'vera@gmail.com',
      sendInvite: true,
      saveEmailToCard: true,
    });

    expect(publisher.contactsConfirmedAt).toBeNull();
  });

  it('never writes over an address the card already holds', async () => {
    // The husband's mailbox, borrowed for one letter, must not replace her own.
    const { service, publisher } = build('vera@gmail.com');

    await grant(service, {
      email: 'aleksandr@gmail.com',
      sendInvite: true,
      saveEmailToCard: true,
    });

    expect(publisher.email).toBe('vera@gmail.com');
  });

  it('leaves the card alone when nobody asked', async () => {
    const { service, publisher, save } = build(null);

    await grant(service, { email: 'vera@gmail.com', sendInvite: true });

    expect(publisher.email).toBeNull();
    // One save for the card-to-account link, and no second one for contacts.
    expect(save).toHaveBeenCalledTimes(1);
  });
});
