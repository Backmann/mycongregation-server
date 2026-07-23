/**
 * Did this report say the publisher shared in the ministry that month?
 *
 * ONE definition, because several parts of the app ask the same question and
 * must not answer it differently: the rolling service status, the monthly
 * summary, and the annual congregation report all rest on it. What they do
 * with the answer differs enormously — the status looks at a moving window and
 * asks "who is this person now", the annual report looks at fixed windows of a
 * finished year — but the underlying fact is the same fact, and it should have
 * a single home.
 *
 * A row can exist and still mean "no": a publisher may submit a report saying
 * they did not share. Hours above zero count as sharing even where the flag
 * was left unset, which is how older rows were written.
 */
export function reportedMinistry(report: {
  servedThisMonth?: boolean | null;
  hoursReported?: number | null;
}): boolean {
  return (
    report.servedThisMonth === true ||
    (report.hoursReported !== null &&
      report.hoursReported !== undefined &&
      report.hoursReported > 0)
  );
}
