import { PresenceService, ONLINE_WINDOW_MS } from './presence.service';

describe('PresenceService', () => {
  let usersRepo: { update: jest.Mock };
  let service: PresenceService;
  const T0 = 1_700_000_000_000;

  beforeEach(() => {
    usersRepo = { update: jest.fn().mockResolvedValue(undefined) };
    service = new PresenceService(usersRepo as never);
  });

  describe('touch', () => {
    it('writes lastSeenAt on the first touch', () => {
      service.touch('u1', T0);
      expect(usersRepo.update).toHaveBeenCalledTimes(1);
      expect(usersRepo.update).toHaveBeenCalledWith('u1', {
        lastSeenAt: new Date(T0),
      });
    });

    it('throttles repeated touches within the write window', () => {
      service.touch('u1', T0);
      service.touch('u1', T0 + 30_000); // 30s later
      expect(usersRepo.update).toHaveBeenCalledTimes(1);
    });

    it('writes again once the throttle window has passed', () => {
      service.touch('u1', T0);
      service.touch('u1', T0 + 3 * 60 * 1000); // 3 min later
      expect(usersRepo.update).toHaveBeenCalledTimes(2);
    });

    it('throttles each user independently', () => {
      service.touch('u1', T0);
      service.touch('u2', T0);
      expect(usersRepo.update).toHaveBeenCalledTimes(2);
    });

    it('never throws when the write rejects', () => {
      usersRepo.update.mockRejectedValueOnce(new Error('db down'));
      expect(() => service.touch('u1', T0)).not.toThrow();
    });
  });

  describe('isOnline', () => {
    it('is false when never seen', () => {
      expect(PresenceService.isOnline(null, T0)).toBe(false);
    });

    it('is true within the online window', () => {
      const seen = new Date(T0 - (ONLINE_WINDOW_MS - 1000));
      expect(PresenceService.isOnline(seen, T0)).toBe(true);
    });

    it('is false past the online window', () => {
      const seen = new Date(T0 - (ONLINE_WINDOW_MS + 1000));
      expect(PresenceService.isOnline(seen, T0)).toBe(false);
    });
  });
});
