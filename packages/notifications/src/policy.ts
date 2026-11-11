import type { ChangeKind, EntityType, NotificationCategory } from '@campuswatch/contracts';

export const CATEGORY_OF: Readonly<Record<EntityType, NotificationCategory>> = {
  grade_course: 'grades',
  grade_summary: 'grades',
  tuition_term: 'tuition',
  tuition_course: 'tuition',
  timetable_class: 'timetable',
  exam: 'exams',
  portal_notice: 'notices',
};

/**
 * Grades and tuition are sent immediately even during quiet hours; timetable, exams, and
 * notices wait until quiet hours end (implementation plan, section 10).
 */
export const URGENT_CATEGORIES: ReadonlySet<NotificationCategory> = new Set(['grades', 'tuition']);

/** Whether a change event should notify at all. Notices notify only when they first appear. */
export function isNotifiable(event: { entityType: EntityType; kind: ChangeKind }): boolean {
  return event.entityType !== 'portal_notice' || event.kind === 'ADDED';
}
