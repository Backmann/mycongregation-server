/**
 * What the duties need of the Memorial — a token and a shape, not the
 * service itself, so the duties do not load the notifications with it.
 */
export const MEMORIAL_CHANGES = 'MEMORIAL_CHANGES';

export interface MemorialChanges {
  tellChange(
    congregationId: string,
    weekStartDate: string,
    change: { added: string | null; removed: string | null; label: string },
  ): Promise<void>;
}
