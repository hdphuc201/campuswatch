import { diffEntities } from '@campuswatch/portal-core';
import { describe, expect, it } from 'vitest';
import { finalizeDrafts } from '../draft.js';
import { CollectorError } from '../errors.js';
import { fixture, html } from '../test-support.js';
import { detectSession, noticeDrafts, parseNoticeTexts } from './dashboard.js';
import { parseGrades } from './grades.js';
import { parseExams, parseTimetable } from './schedule.js';
import { parseTuition } from './tuition.js';

function driftDetail(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof CollectorError && error.code === 'ADAPTER_NEEDS_UPDATE') {
      return error.detail;
    }
    throw error;
  }
  return undefined;
}

describe('parseGrades', () => {
  const drafts = parseGrades(fixture('grades.html'));
  const byKey = new Map(drafts.map((draft) => [`${draft.entityType}:${draft.externalKey}`, draft]));

  it('reads courses per semester with normalized codes, names, and scores', () => {
    expect(byKey.get('grade_course:2025-2026|1|CS101|')?.payload).toEqual({
      academicYear: '2025-2026',
      semester: '1',
      courseCode: 'CS101',
      courseName: 'Nhập môn lập trình',
      classCode: null,
      credits: 3,
      practiceScore: null,
      processScore: 8.5,
      midtermScore: 7,
      finalExamScore: 8,
      totalScore: 7.9,
      totalScore4: 3,
      letterGrade: 'B',
    });
    expect(byKey.get('grade_course:2025-2026|1|MA101|')?.payload.courseName).toBe('Giải tích 1');
  });

  it('handles grouped two-row headers and unpublished "-" scores', () => {
    expect(byKey.get('grade_course:2025-2026|2|CS102|CS102.02')?.payload).toMatchObject({
      processScore: 9,
      midtermScore: null,
      finalExamScore: null,
      totalScore: null,
      totalScore4: null,
    });
    expect(byKey.get('grade_course:2025-2026|2|PE101|PE101.05')?.payload.processScore).toBe('M');
  });

  it('reads semester and cumulative summaries', () => {
    expect(byKey.get('grade_summary:2025-2026|1')?.payload).toEqual({
      academicYear: '2025-2026',
      semester: '1',
      gpa10: 8.44,
      gpa4: 3.4,
      creditsEarned: 7,
    });
    expect(byKey.get('grade_summary:cumulative')?.payload).toEqual({
      gpa10: 8.44,
      gpa4: 3.4,
      creditsAccumulated: 7,
    });
    // No summary lines under semester 2 yet.
    expect(byKey.has('grade_summary:2025-2026|2')).toBe(false);
  });

  it('is unaffected by reordered and extra columns', async () => {
    const original = (await finalizeDrafts(drafts)).filter(
      (entity) => entity.entityType === 'grade_course' && entity.externalKey.includes('|1|'),
    );
    const reordered = (await finalizeDrafts(parseGrades(fixture('grades-reordered.html')))).filter(
      (entity) => entity.entityType === 'grade_course',
    );
    expect(diffEntities(original, reordered)).toEqual([]);
  });

  it('detects a regrade and a new course as field-level changes', async () => {
    const before = await finalizeDrafts(drafts);
    const after = await finalizeDrafts(parseGrades(fixture('grades-changed.html')));

    const changes = diffEntities(before, after);
    expect(
      changes.map((change) => `${change.kind} ${change.entityType} ${change.externalKey}`),
    ).toEqual([
      'UPDATED grade_course 2025-2026|1|CS101|',
      'ADDED grade_course 2025-2026|2|EN101|EN101.01',
      'UPDATED grade_summary 2025-2026|1',
      'UPDATED grade_summary cumulative',
    ]);
    expect(changes[0]?.changedFields).toEqual([
      { field: 'finalExamScore', before: 8, after: 9 },
      { field: 'totalScore', before: 7.9, after: 8.4 },
    ]);
  });

  it('returns no entities for an explicit "no data yet" page', () => {
    expect(parseGrades(fixture('grades-empty.html'))).toEqual([]);
  });

  it('parses browser-tolerated malformed markup inside layout tables', () => {
    const malformed = parseGrades(fixture('grades-malformed.html'));
    expect(malformed.map((draft) => draft.externalKey)).toEqual([
      '2025-2026|1|CS101|',
      '2025-2026|1|MA101|',
    ]);
  });

  it('reports drift naming the missing column, never the data', () => {
    const detail = driftDetail(() => parseGrades(fixture('grades-missing-column.html')));
    expect(detail).toBe('grades: table columns changed');
    expect(detail).not.toContain('7,9');
  });

  it('reports drift for an unrecognizable page instead of returning nothing', () => {
    expect(driftDetail(() => parseGrades(html('<p>Hệ thống đang bảo trì</p>')))).toBe(
      'grades: table not found',
    );
  });

  it('reports drift for impossible values', () => {
    const doc = html(`<h3>Học kỳ 1 năm học 2025-2026</h3><table>
      <tr><th>Mã môn học</th><th>Tên môn học</th><th>Số TC</th><th>Điểm TK</th></tr>
      <tr><td>CS101</td><td>X</td><td>3</td><td>79</td></tr></table>`);
    expect(driftDetail(() => parseGrades(doc))).toBe('grades.total: score out of range');
  });

  it('keeps a course listed twice in one semester as two entities', async () => {
    const doc = html(`<h3>Học kỳ 1 năm học 2025-2026</h3><table>
      <tr><th>Mã môn học</th><th>Tên môn học</th><th>Số TC</th><th>Điểm TK</th></tr>
      <tr><td>CS101</td><td>A</td><td>3</td><td>4</td></tr>
      <tr><td>CS101</td><td>A</td><td>3</td><td>8</td></tr></table>`);
    const keys = (await finalizeDrafts(parseGrades(doc))).map((entity) => entity.externalKey);
    expect(keys).toEqual(['2025-2026|1|CS101|', '2025-2026|1|CS101|#2']);
  });
});

describe('parseTuition', () => {
  const drafts = parseTuition(fixture('tuition.html'));

  it('reads term summaries with integer VND, ISO due dates, and status codes', () => {
    expect(drafts.filter((d) => d.entityType === 'tuition_term').map((d) => d.payload)).toEqual([
      {
        academicYear: '2025-2026',
        semester: '1',
        tuitionFee: 9_800_000,
        previousDebt: 0,
        amountDue: 9_800_000,
        amountPaid: 9_800_000,
        balance: 0,
        dueDate: '2025-09-15',
        status: 'PAID',
        statusText: 'Đã hoàn thành',
      },
      {
        academicYear: '2025-2026',
        semester: '2',
        tuitionFee: 10_500_000,
        previousDebt: null,
        amountDue: 10_500_000,
        amountPaid: 5_000_000,
        balance: 5_500_000,
        dueDate: '2026-02-15',
        status: 'UNPAID',
        statusText: 'Còn nợ',
      },
    ]);
  });

  it('reads per-course fee details under the term heading', () => {
    const courses = drafts.filter((d) => d.entityType === 'tuition_course');
    expect(courses.map((d) => d.externalKey)).toEqual([
      '2025-2026|2|CS102.02',
      '2025-2026|2|PE101.05',
      '2025-2026|2|EN101.01',
    ]);
    expect(courses[2]?.payload).toMatchObject({
      feeType: 'Học lại',
      amount: 4_500_000,
      credits: 2,
    });
  });

  it('returns nothing for an explicit "no tuition data" page', () => {
    expect(parseTuition(html('<p>Chưa có dữ liệu học phí.</p>'))).toEqual([]);
  });
});

describe('parseTimetable and parseExams', () => {
  it('reads weekly meetings using the selected semester', () => {
    const drafts = parseTimetable(fixture('timetable.html'));
    expect(drafts.map((d) => d.externalKey)).toEqual([
      '2025-2026|2|CS102.02|2|07:30',
      '2025-2026|2|CS102.02|5|13:00',
      '2025-2026|2|PE101.05|8|p1-3',
    ]);
    expect(drafts[2]?.payload).toMatchObject({
      weekday: 8,
      startTime: null,
      periods: '1-3',
      lecturer: null,
      startDate: '2026-01-11',
    });
  });

  it('reads exams with ISO dates and start times', () => {
    const drafts = parseExams(fixture('exams.html'));
    expect(drafts.map((d) => d.externalKey)).toEqual([
      '2025-2026|2|CS102|2026-05-20|Ca 1',
      '2025-2026|2|EN101|2026-05-22|Ca 3',
    ]);
    expect(drafts[0]?.payload).toMatchObject({ startTime: '07:30', room: 'A2.101' });
    expect(drafts[1]?.payload).toMatchObject({ startTime: '13:00', room: null });
  });

  it('supports "no exam schedule yet"', () => {
    expect(parseExams(fixture('exams-none.html'))).toEqual([]);
  });
});

describe('dashboard', () => {
  it('detects logged-in and login pages', () => {
    expect(detectSession(fixture('dashboard.html'), 'https://portal.citd.edu.vn/')).toBe(
      'authenticated',
    );
    expect(detectSession(fixture('dashboard-no-popup.html'), 'https://portal.citd.edu.vn/')).toBe(
      'authenticated',
    );
    expect(detectSession(fixture('login.html'), 'https://portal.citd.edu.vn/')).toBe(
      'login_required',
    );
    expect(detectSession(html('<p>ok</p>'), 'https://portal.citd.edu.vn/Account/Login')).toBe(
      'login_required',
    );
    expect(driftDetail(() => detectSession(html('<p>?</p>'), 'https://portal.citd.edu.vn/'))).toBe(
      'dashboard: session marker not found',
    );
  });

  it('extracts the notice popup once, keyed by a content hash', async () => {
    const notices = parseNoticeTexts(fixture('dashboard.html'));
    expect(notices).toEqual([
      {
        title: 'Thông báo lịch nghỉ lễ',
        body: 'Sinh viên được nghỉ học từ ngày 01/01/2027 đến hết ngày 02/01/2027.',
      },
    ]);
    const [draft] = await noticeDrafts(notices);
    expect(draft?.externalKey).toMatch(/^[0-9a-f]{32}$/);
    expect(parseNoticeTexts(fixture('dashboard-no-popup.html'))).toEqual([]);
  });
});
