/**
 * Publisher service-status, derived from the last 6 calendar months of
 * service reports. Stored on the Publisher row and recomputed whenever a
 * report is submitted or edited, unless statusManuallyOverridden=true.
 */
export enum PublisherStatus {
  ACTIVE = 'active',
  IRREGULAR = 'irregular',
  INACTIVE = 'inactive',
}
