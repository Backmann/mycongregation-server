import { Not } from 'typeorm';
import { PublisherAppointment } from './enums/publisher-appointment.enum';

/**
 * Who is expected to hand in a field-service report.
 *
 * Students (what the app calls «участник») do not submit reports, and someone
 * marked as no longer in the congregation is not chased for one either.
 *
 * This lived only inside the reminder job. The collection card counts the same
 * people, and two copies of "who owes a report" is exactly how a card comes to
 * say 34 из 46 while the reminders chase a different 47 — the same drift that
 * once let a student be hidden on one screen and shown on another.
 */
export function reportingPublisherWhere(congregationId: string): {
  congregationId: string;
  isActive: boolean;
  appointment: ReturnType<typeof Not<PublisherAppointment>>;
} {
  return {
    congregationId,
    isActive: true,
    appointment: Not(PublisherAppointment.STUDENT),
  };
}
