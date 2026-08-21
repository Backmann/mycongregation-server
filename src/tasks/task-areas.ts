/**
 * The areas a task can belong to — in ONE place.
 *
 * They used to live in four: a union type on the entity, a list in the
 * controller, and a CHECK constraint on each of two tables. That is not a
 * theoretical risk. «Объявления» was added to the type and to the form and not
 * to the database's check, and a task in that area simply would not save.
 *
 * The type is derived from the list, so the two cannot drift. The database is
 * the one copy TypeScript cannot reach — a migration writes it — so a test
 * reads the migrations and refuses to pass when they and this list disagree.
 * See task-areas.spec.ts: it is the guard for the fourth place.
 *
 * ADDING AN AREA: put it here, write a migration widening the CHECK on
 * elder_tasks and elders_meeting_items, and add the word to the app's locales.
 * The test will tell you if you forget the migration.
 */
export const TASK_AREAS = [
  'ministry',
  'teaching',
  'care',
  'organisation',
  // Reading a letter to the congregation is neither organisation nor accounts,
  // and it is the one kind of task with an hour attached to it.
  'announcements',
  'accounts',
  'other',
] as const;

export type TaskArea = (typeof TASK_AREAS)[number];

/** The tables whose CHECK constraint must list exactly these areas. */
export const TABLES_CONSTRAINED_BY_AREA = [
  'elder_tasks',
  'elders_meeting_items',
] as const;
