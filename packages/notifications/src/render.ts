import type {
  ChangeEvent,
  DetailLevel,
  NotificationCategory,
  RenderedNotification,
} from '@campuswatch/contracts';
import { describeChange } from './describe.js';
import { CATEGORY_OF } from './policy.js';

type RenderableChange = Pick<
  ChangeEvent,
  'entityType' | 'externalKey' | 'kind' | 'changedFields' | 'payload'
>;

const CATEGORY_LABELS: Record<NotificationCategory, [singular: string, plural: string]> = {
  grades: ['grade update', 'grade updates'],
  tuition: ['tuition update', 'tuition updates'],
  timetable: ['timetable change', 'timetable changes'],
  exams: ['exam schedule change', 'exam schedule changes'],
  notices: ['new Portal notice', 'new Portal notices'],
};

const CATEGORY_ORDER: NotificationCategory[] = [
  'grades',
  'tuition',
  'exams',
  'timetable',
  'notices',
];
const MAX_DETAILED_ITEMS = 10;

/**
 * One notification for a batch of changes. `summary` (the default) states only categories and
 * counts: no course names, scores, or amounts, so it is safe on a lock screen or in a chat
 * preview. `detailed` lists each change and is opt-in.
 */
export function renderNotification(
  changes: readonly RenderableChange[],
  detailLevel: DetailLevel,
): RenderedNotification {
  const counts = new Map<NotificationCategory, number>();
  for (const change of changes) {
    const category = CATEGORY_OF[change.entityType];
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const parts = CATEGORY_ORDER.filter((category) => counts.has(category)).map((category) => {
    const count = counts.get(category)!;
    const [singular, plural] = CATEGORY_LABELS[category];
    return `${count} ${count === 1 ? singular : plural}`;
  });
  const title =
    changes.length === 1 ? 'CampusWatch: 1 update' : `CampusWatch: ${changes.length} updates`;

  if (detailLevel === 'summary') {
    return { title, body: `${parts.join(', ')}. Open CampusWatch to see the details.` };
  }

  const lines = changes.slice(0, MAX_DETAILED_ITEMS).map((change) => {
    const { title: line, details } = describeChange(change);
    return details.length > 0 ? `${line} (${details.join('; ')})` : line;
  });
  if (changes.length > MAX_DETAILED_ITEMS) {
    lines.push(`…and ${changes.length - MAX_DETAILED_ITEMS} more.`);
  }
  return { title, body: lines.join('\n') };
}
