import { ScheduledJobsService } from './scheduled-jobs.service';

describe('ScheduledJobsService', () => {
  let service: ScheduledJobsService;
  let publishersService: { recomputeAllStatuses: jest.Mock };

  beforeEach(() => {
    publishersService = {
      recomputeAllStatuses: jest.fn().mockResolvedValue({
        processed: 5,
        updated: 2,
        unchanged: 1,
        skipped: 1,
        errors: 1,
        durationMs: 250,
      }),
    };
    service = new ScheduledJobsService(publishersService as any);
  });

  it('handleNightlyStatusRecompute delegates to recomputeAllStatuses', async () => {
    await service.handleNightlyStatusRecompute();
    expect(publishersService.recomputeAllStatuses).toHaveBeenCalledTimes(1);
  });

  it('swallows errors without re-throwing so the cron host stays alive', async () => {
    publishersService.recomputeAllStatuses.mockRejectedValue(
      new Error('boom'),
    );
    await expect(
      service.handleNightlyStatusRecompute(),
    ).resolves.toBeUndefined();
  });
});
