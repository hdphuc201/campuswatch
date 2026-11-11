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

const GRADE_TABLE = (rows: string) => `<h2>HK: 1 - Năm: 2025 - 2026</h2><table>
  <tr><th>Mã môn học</th><th>Tên môn học</th><th>Số tín chỉ</th><th>Điểm Học Phần</th></tr>
  ${rows}</table>`;

describe('parseGrades', () => {
  const drafts = parseGrades(fixture('grades.html'));
  const byKey = new Map(drafts.map((draft) => [`${draft.entityType}:${draft.externalKey}`, draft]));

  it('reads courses under each "HK: 1 - Năm: 2025 - 2026" heading', () => {
    expect(drafts.map((draft) => `${draft.entityType}:${draft.externalKey}`)).toEqual([
      'grade_course:2025-2026|2|CS102|',
      'grade_course:2025-2026|2|PE101|',
      'grade_course:2025-2026|1|CS101|',
      'grade_course:2025-2026|1|MA101|',
      'grade_summary:cumulative',
    ]);
    expect(byKey.get('grade_course:2025-2026|1|CS101|')?.payload).toEqual({
      academicYear: '2025-2026',
      semester: '1',
      courseCode: 'CS101',
      courseName: 'Nhập môn lập trình',
      classCode: null,
      credits: 3,
      practiceScore: 8.5,
      processScore: 8.5,
      midtermScore: 7,
      finalExamScore: 8,
      totalScore: 7.9,
      totalScore4: null,
      letterGrade: null,
    });
  });

  it('keeps unpublished "-" scores as null', () => {
    expect(byKey.get('grade_course:2025-2026|2|CS102|')?.payload).toMatchObject({
      practiceScore: null,
      processScore: 9,
      midtermScore: null,
      finalExamScore: null,
      totalScore: null,
    });
  });

  it('reads the "Tổng kết" block as the cumulative summary', () => {
    expect(byKey.get('grade_summary:cumulative')?.payload).toEqual({
      gpa10: 8.44,
      overallGpa10: 8.44,
      creditsAccumulated: 7,
      creditsAttempted: 11,
    });
  });

  it('is unaffected by reordered and extra columns', async () => {
    const original = (await finalizeDrafts(drafts)).filter(
      (entity) => entity.entityType === 'grade_course' && entity.externalKey.includes('|1|'),
    );
    const reordered = await finalizeDrafts(parseGrades(fixture('grades-reordered.html')));
    expect(diffEntities(original, reordered)).toEqual([]);
  });

  it('detects a regrade, a new course, and a new GPA as field-level changes', async () => {
    const before = await finalizeDrafts(drafts);
    const after = await finalizeDrafts(parseGrades(fixture('grades-changed.html')));

    const changes = diffEntities(before, after);
    expect(
      changes.map((change) => `${change.kind} ${change.entityType} ${change.externalKey}`),
    ).toEqual([
      'UPDATED grade_course 2025-2026|1|CS101|',
      'ADDED grade_course 2025-2026|2|EN101|',
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
    expect(detail).not.toContain('7.9');
  });

  it('reports drift for an unrecognizable page instead of returning nothing', () => {
    expect(driftDetail(() => parseGrades(html('<p>Hệ thống đang bảo trì</p>')))).toBe(
      'grades: table not found',
    );
  });

  it('reports drift for impossible values', () => {
    const score = html(GRADE_TABLE('<tr><td>CS101</td><td>X</td><td>3</td><td>79</td></tr>'));
    expect(driftDetail(() => parseGrades(score))).toBe('grades.total: score out of range');

    const gpa = html(
      `<div><p>Điểm trung bình tích luỹ</p><p>84.4</p></div>` +
        GRADE_TABLE('<tr><td>CS101</td><td>X</td><td>3</td><td>7</td></tr>'),
    );
    expect(driftDetail(() => parseGrades(gpa))).toBe('grades.summary.gpa10: value out of range');
  });

  it('keeps a course listed twice in one semester as two entities', async () => {
    const doc = html(
      GRADE_TABLE(`<tr><td>CS101</td><td>A</td><td>3</td><td>4</td></tr>
        <tr><td>CS101</td><td>A</td><td>3</td><td>8</td></tr>`),
    );
    const keys = (await finalizeDrafts(parseGrades(doc))).map((entity) => entity.externalKey);
    expect(keys).toEqual(['2025-2026|1|CS101|', '2025-2026|1|CS101|#2']);
  });
});

describe('parseTuition', () => {
  const drafts = parseTuition(fixture('tuition.html'));

  it('reads each term block with integer VND, ISO dates, and a status code', () => {
    expect(drafts.map((draft) => draft.entityType)).toEqual(['tuition_term', 'tuition_term']);
    expect(drafts.map((draft) => draft.payload)).toEqual([
      {
        academicYear: '2025-2026',
        semester: '2',
        registeredCredits: 13,
        registeredCourses: 4,
        tuitionFee: 10_500_000,
        previousDebt: 0,
        amountDue: 10_500_000,
        amountPaid: 5_000_000,
        balance: 5_500_000,
        dueDate: '2026-02-15',
        paidDate: null,
        status: 'UNPAID',
        statusText: 'Chưa đóng',
      },
      {
        academicYear: '2025-2026',
        semester: '1',
        registeredCredits: 15,
        registeredCourses: 5,
        tuitionFee: 9_800_000,
        previousDebt: 0,
        amountDue: 9_800_000,
        amountPaid: 9_800_000,
        balance: 0,
        dueDate: '2025-09-15',
        paidDate: '2025-09-10',
        status: 'PAID',
        statusText: 'Đúng hạn',
      },
    ]);
  });

  it('never reads the per-course detail tables (they load through a POST request)', () => {
    expect(drafts.some((draft) => draft.entityType === 'tuition_course')).toBe(false);
  });

  it('returns nothing for an explicit "no tuition data" page', () => {
    expect(parseTuition(html('<p>Chưa có dữ liệu học phí.</p>'))).toEqual([]);
  });

  it('reports drift when a term block lost its amounts, or no term block is found', () => {
    const doc = html(`<h2>Thông tin học phí học kỳ 1 - Năm học 2025 - 2026</h2>
      <div><span>3. Học phí</span><span>9,800,000</span></div>`);
    expect(driftDetail(() => parseTuition(doc))).toBe(
      'tuition: missing fields amountDue, amountPaid, balance',
    );
    expect(driftDetail(() => parseTuition(html('<p>?</p>')))).toBe(
      'tuition: term sections not found',
    );
  });
});

describe('parseTimetable', () => {
  const FILTER = `<select name="education_semester_id"><option selected>2</option></select>
    <select name="education_year_id"><option selected>2025 - 2026</option></select>`;
  const TABLE = (schedule: string) => `<table>
    <tr><th>#</th><th>Lớp / Môn học</th><th>Lịch học / Thời gian</th></tr>
    <tr><td>1</td><td><p>CS102.B21</p><p>CS102 Cấu trúc dữ liệu</p></td>
    <td><p>${schedule}</p></td></tr></table>`;

  it('splits the class/course and schedule cells, using the selected semester', () => {
    const drafts = parseTimetable(fixture('timetable.html'));
    expect(drafts.map((d) => d.externalKey)).toEqual([
      '2025-2026|2|CS102.B21|2|07:30',
      '2025-2026|2|CS102.B21.1|5|13:00',
      '2025-2026|2|PE101.B25|8|07:30',
    ]);
    expect(drafts[0]?.payload).toEqual({
      academicYear: '2025-2026',
      semester: '2',
      classCode: 'CS102.B21',
      courseCode: 'CS102',
      courseName: 'Cấu trúc dữ liệu',
      credits: 3,
      weekday: 2,
      startTime: '07:30',
      endTime: '09:45',
      periods: null,
      room: null,
      lecturer: 'Giảng viên A',
      startDate: '2026-01-05',
      endDate: '2026-05-15',
      feeType: 'Học mới',
    });
    expect(drafts[2]?.payload).toMatchObject({ weekday: 8, lecturer: null });
  });

  it('keeps a class without a weekly slot once', () => {
    const drafts = parseTimetable(html(FILTER + TABLE('Chưa xếp lịch')));
    expect(drafts.map((d) => d.externalKey)).toEqual(['2025-2026|2|CS102.B21|unscheduled|']);
  });

  it('reports drift for an unreadable schedule line or a missing semester filter', () => {
    expect(driftDetail(() => parseTimetable(html(FILTER + TABLE('Thứ 9, 7h30 - 9h45'))))).toBe(
      'timetable: schedule not recognized',
    );
    expect(driftDetail(() => parseTimetable(html(FILTER + TABLE('Thứ 2, buổi sáng 1'))))).toBe(
      'timetable.time: not a time slot',
    );
    expect(driftDetail(() => parseTimetable(html(FILTER + TABLE('Thứ 2 7h30 9h45'))))).toBe(
      'timetable: schedule not recognized',
    );
    expect(driftDetail(() => parseTimetable(html(TABLE('Thứ 2, 7h30 - 9h45'))))).toBe(
      'timetable: selected semester not found',
    );
  });
});

describe('parseExams', () => {
  it('reads the course code from its own element in the name cell', () => {
    const drafts = parseExams(fixture('exams.html'));
    expect(drafts.map((d) => d.externalKey)).toEqual([
      '2025-2026|2|CS102|2026-05-20|1',
      '2025-2026|2|EN101|2026-05-22|3',
    ]);
    expect(drafts[0]?.payload).toEqual({
      academicYear: '2025-2026',
      semester: '2',
      courseCode: 'CS102',
      courseName: 'Cấu trúc dữ liệu',
      classCode: 'CS102.B21',
      credits: 3,
      lecturer: 'Giảng viên A',
      date: '2026-05-20',
      shift: '1',
      startTime: null,
      room: 'B1.01',
      feeType: 'Học mới',
      examType: 'Tự luận',
    });
  });

  it('falls back to the "Học kỳ" / "Năm học" summary and a "CODE Name" cell', () => {
    const doc = html(`<div><p>Học kỳ</p><p>3</p></div><div><p>Năm học</p><p>2024 - 2025</p></div>
      <table><tr><th>Tên môn</th><th>Ngày thi</th><th>Ca thi</th></tr>
      <tr><td>MA101 Giải tích 1</td><td>02/07/2025</td><td>2</td></tr></table>`);
    expect(parseExams(doc).map((d) => [d.externalKey, d.payload.courseName])).toEqual([
      ['2024-2025|3|MA101|2025-07-02|2', 'Giải tích 1'],
    ]);
  });

  it('supports "no exam schedule yet"', () => {
    expect(parseExams(fixture('exams-none.html'))).toEqual([]);
  });
});

describe('dashboard', () => {
  it('detects logged-in and login pages', () => {
    const url = 'https://portal.citd.edu.vn/student';
    expect(detectSession(fixture('dashboard.html'), url)).toBe('authenticated');
    expect(detectSession(fixture('dashboard-no-popup.html'), url)).toBe('authenticated');
    expect(detectSession(fixture('login.html'), url)).toBe('login_required');
    expect(detectSession(html('<p>ok</p>'), 'https://portal.citd.edu.vn/login')).toBe(
      'login_required',
    );
    // The Portal logs out through a form, not a link.
    expect(detectSession(html('<form method="post" action="/logout"></form>'), url)).toBe(
      'authenticated',
    );
    expect(driftDetail(() => detectSession(html('<p>?</p>'), url))).toBe(
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
