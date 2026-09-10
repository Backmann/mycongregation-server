import { CalendarTasksService } from './calendar-tasks.service';

/**
 * Ночной заход и уже живые задачи.
 *
 * Заводить заново он их не должен — удалённая задача не возвращается, и это
 * правило проверено в другом месте. Но когда меняется САМО правило (обзор
 * служебного года переехал с 31 августа на 20 сентября), у живой задачи
 * остаётся прежний срок, и она числится просроченной, хотя работа идёт по
 * новому порядку. Ждать следующего года — значит целый год показывать
 * неправду.
 *
 * Тестов у этого захода не было вовсе: проверялось только чистое правило дат.
 */
describe('CalendarTasksService.ensureForToday', () => {
  const build = (opts: {
    offered: boolean;
    live?: Record<string, unknown> | null;
  }) => {
    const saved: Record<string, unknown>[] = [];
    const service = Object.create(
      CalendarTasksService.prototype,
    ) as CalendarTasksService;
    Object.assign(service, {
      logger: { log: jest.fn(), warn: jest.fn() },
      congregations: { find: jest.fn(async () => [{ id: 'cong-1' }]) },
      tasks: {
        create: jest.fn((x: Record<string, unknown>) => x),
        save: jest.fn(async (x: Record<string, unknown>) => {
          saved.push(x);
          return x;
        }),
        // Подделка обязана смотреть НА ЗАПРОС: за один заход планов
        // несколько, и отдавая одну и ту же задачу всем, она позволяла
        // последнему плану переписать её срок своим.
        findOne: jest.fn(async (q: { where: { kind?: string } }) =>
          opts.live && q.where.kind === 'service_year_review'
            ? opts.live
            : null,
        ),
      },
      log: {
        findOne: jest.fn(async () => (opts.offered ? { id: 'log-1' } : null)),
        create: jest.fn((x: Record<string, unknown>) => x),
        save: jest.fn(async (x: Record<string, unknown>) => x),
      },
    });
    return { service, saved };
  };

  it('поправляет срок у живой задачи, когда правило изменилось', async () => {
    const live = {
      id: 'task-1',
      kind: 'service_year_review',
      kindPeriod: '2026',
      status: 'open',
      createdById: null,
      dueDate: '2026-08-31',
    };
    const { service, saved } = build({ offered: true, live });

    await service.ensureForToday(new Date('2026-09-10T08:00:00Z'));

    expect(live.dueDate).toBe('2026-09-20');
    expect(saved).toContain(live);
  });

  it('не заводит задачу заново, если она уже предлагалась', async () => {
    // Удалённая задача не возвращается — это старое правило, и оно остаётся.
    const { service, saved } = build({ offered: true, live: null });

    await service.ensureForToday(new Date('2026-09-10T08:00:00Z'));

    expect(saved).toHaveLength(0);
  });

  it('не трогает срок, если он уже верный', async () => {
    const live = {
      id: 'task-1',
      status: 'open',
      createdById: null,
      dueDate: '2026-09-20',
    };
    const { service, saved } = build({ offered: true, live });

    await service.ensureForToday(new Date('2026-09-10T08:00:00Z'));

    expect(saved).toHaveLength(0);
  });
});
