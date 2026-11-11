import type { ChangeEvent } from '@campuswatch/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { describeChange } from '@campuswatch/notifications';
import { RecentChanges } from './components.js';

const base = {
  id: '00000000-0000-4000-8000-000000000001',
  connectionId: '00000000-0000-4000-8000-000000000002',
  createdAt: '2026-11-11T07:00:00.000Z',
} as const;

const change = (patch: Partial<ChangeEvent>): ChangeEvent => ({
  ...base,
  entityType: 'grade_course',
  externalKey: 'k',
  kind: 'UPDATED',
  changedFields: [],
  payload: {},
  ...patch,
});

describe('describeChange', () => {
  it('describes a regrade with before and after values', () => {
    expect(
      describeChange(
        change({
          payload: { courseCode: 'CS101', courseName: 'Nhập môn lập trình', totalScore: 8.4 },
          changedFields: [
            { field: 'finalExamScore', before: 8, after: 9 },
            { field: 'totalScore', before: 7.9, after: 8.4 },
          ],
        }),
      ),
    ).toEqual({
      title: 'Updated: CS101 Nhập môn lập trình',
      details: ['Final exam: 8 → 9', 'Total score: 7.9 → 8.4'],
    });
  });

  it('formats money, missing values, and notices', () => {
    expect(
      describeChange(
        change({
          entityType: 'tuition_term',
          payload: { academicYear: '2025-2026', semester: '2' },
          changedFields: [
            { field: 'balance', before: 5_500_000, after: 0 },
            { field: 'dueDate', after: '2026-02-15' },
          ],
        }),
      ).details,
    ).toEqual([
      `Balance: ${(5_500_000).toLocaleString('vi-VN')} ₫ → 0 ₫`,
      'Due date: — → 2026-02-15',
    ]);
    expect(
      describeChange(
        change({ entityType: 'portal_notice', kind: 'ADDED', payload: { title: 'Holiday' } }),
      ).title,
    ).toBe('New: Portal notice: Holiday');
  });
});

describe('RecentChanges', () => {
  it('renders an empty state and a list', () => {
    const now = new Date('2026-11-11T08:00:00.000Z');
    expect(renderToStaticMarkup(<RecentChanges changes={[]} now={now} />)).toContain(
      'No changes yet',
    );
    const html = renderToStaticMarkup(
      <RecentChanges
        changes={[change({ kind: 'ADDED', payload: { courseCode: 'EN101' } })]}
        now={now}
      />,
    );
    expect(html).toContain('New: EN101');
    expect(html).toContain('1 h ago');
  });
});
