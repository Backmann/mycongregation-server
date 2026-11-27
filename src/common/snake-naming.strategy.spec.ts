import { SnakeNamingStrategy, snakeCase } from './snake-naming.strategy';

/**
 * The methods no entity reaches today (an unnamed junction table, embedded
 * columns, eager aliases), pinned to what `typeorm-naming-strategies` 4.1.0
 * returned for them (independent check, 27 November 2026).
 */
describe('our snake naming, the methods no entity uses yet', () => {
  const s = new SnakeNamingStrategy();
  it('words split as before', () => {
    expect(
      ['userID', 'HTMLParser', 'S10Report', 'publisherId', 'already_snake'].map(
        snakeCase,
      ),
    ).toEqual([
      'user_id',
      'html_parser',
      's10_report',
      'publisher_id',
      'already_snake',
    ]);
  });
  it('junction tables and their columns', () => {
    expect(s.joinTableName('elder_tasks', 'publishers', 'assignees')).toBe(
      'elder_tasks_assignees_publishers',
    );
    expect(s.joinTableName('a', 'b', 'nested.prop')).toBe('a_nested_prop_b');
    expect(s.joinTableColumnName('elderTasks', 'id')).toBe('elder_tasks_id');
    expect(s.joinTableColumnName('elderTasks', 'id', 'taskId')).toBe(
      'elder_tasks_task_id',
    );
  });
  it('embedded columns, relations, aliases', () => {
    expect(s.columnName('startDate', undefined, ['period'])).toBe(
      'period_start_date',
    );
    expect(s.columnName('x', 'given_name', ['period'])).toBe(
      'period_given_name',
    );
    expect(s.relationName('assigneePublisher')).toBe('assignee_publisher');
    expect(s.joinColumnName('assigneePublisher', 'id')).toBe(
      'assignee_publisher_id',
    );
    expect(s.eagerJoinRelationAlias('task', 'assignee.card')).toBe(
      'task__assignee_card',
    );
    expect(s.classTableInheritanceParentColumnName('people', 'id')).toBe(
      'people_id',
    );
  });
});
