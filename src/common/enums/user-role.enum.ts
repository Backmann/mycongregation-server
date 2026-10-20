export enum UserRole {
  ADMIN = 'admin',
  ELDER = 'elder',
  MINISTERIAL_SERVANT = 'ministerial_servant',
  PUBLISHER = 'publisher',
  /**
   * The screen on the stage (20 October 2026): a laptop or tablet at the
   * lectern that shows the meeting as it runs — and nothing else. Not a
   * person: no publisher card, no notifications. The server refuses it
   * everything but the few readings that screen needs (common/stage.ts).
   */
  STAGE = 'stage',
}
