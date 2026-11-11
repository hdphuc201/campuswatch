import type { DraftEntity } from '../draft.js';
import { drift } from '../errors.js';
import { fieldValue, readLabeledSections } from '../fields.js';
import { type ColumnSpec, findDataTables, readTable } from '../table.js';
import { cellText } from '../text.js';
import { optionalText, parseDecimal, parseInteger, parseScore, requiredCode } from '../values.js';

type GradeField =
  | 'courseCode'
  | 'courseName'
  | 'classCode'
  | 'credits'
  | 'practice'
  | 'process'
  | 'midterm'
  | 'final'
  | 'total'
  | 'total4'
  | 'letter';

export const GRADE_COLUMNS: ColumnSpec<GradeField> = {
  required: ['courseCode', 'courseName', 'credits', 'total'],
  aliases: {
    courseCode: ['ma mon hoc', 'ma mh', 'ma hoc phan', 'ma hp', 'ma mon'],
    courseName: ['ten mon hoc', 'ten hoc phan', 'ten mon', 'mon hoc'],
    classCode: ['lop hoc phan', 'ma lop hoc phan', 'ma lop', 'lop'],
    credits: ['so tc', 'so tin chi', 'tin chi', 'stc', 'tc'],
    practice: ['diem th', 'th', 'thuc hanh', 'diem thuc hanh'],
    process: ['diem qt', 'qt', 'qua trinh', 'diem qua trinh', 'chuyen can'],
    midterm: ['diem gk', 'gk', 'giua ky', 'diem giua ky'],
    final: ['diem ck', 'ck', 'cuoi ky', 'diem cuoi ky', 'diem thi'],
    total: [
      'diem tk 10',
      'diem tk',
      'diem hp',
      'diem hoc phan',
      'diem tong ket',
      'tong ket',
      'he 10',
    ],
    total4: ['diem tk 4', 'diem he 4', 'he 4'],
    letter: ['diem chu', 'chu', 'xep loai'],
  },
};

/** Labels of the "Tổng kết" (overall summary) block above the semester tables. */
const SUMMARY_LABELS = {
  creditsAttempted: ['so tin chi da hoc'],
  creditsAccumulated: ['so tin chi tich luy'],
  overallGpa10: ['diem trung binh chung'],
  gpa10: ['diem trung binh tich luy'],
} as const;

/** The overall summary as one `grade_summary` entity keyed "cumulative", or `null` if absent. */
function parseSummary(doc: Document): DraftEntity | null {
  const fields = readLabeledSections(doc).flatMap((section) => section.fields);
  const text = (aliases: readonly string[]) => {
    const value = fieldValue(fields, aliases);
    return value ? cellText(value) : undefined;
  };
  const raw = Object.fromEntries(
    Object.entries(SUMMARY_LABELS).map(([field, aliases]) => [field, text(aliases)]),
  ) as Record<keyof typeof SUMMARY_LABELS, string | undefined>;
  if (Object.values(raw).every((value) => value === undefined)) {
    return null;
  }
  return {
    entityType: 'grade_summary',
    externalKey: 'cumulative',
    payload: {
      gpa10: parseDecimal(raw.gpa10, 'grades.summary.gpa10', 10),
      overallGpa10: parseDecimal(raw.overallGpa10, 'grades.summary.overallGpa10', 10),
      creditsAccumulated: parseInteger(raw.creditsAccumulated, 'grades.summary.creditsAccumulated'),
      creditsAttempted: parseInteger(raw.creditsAttempted, 'grades.summary.creditsAttempted'),
    },
  };
}

/**
 * Grades page: a "Tổng kết" block of label/value pairs (credits, GPA), then one table per
 * semester under an "HK: 1 - Năm: 2026 - 2027" heading, newest semester first.
 */
export function parseGrades(doc: Document): DraftEntity[] {
  const drafts: DraftEntity[] = [];

  for (const { table, context } of findDataTables(doc, GRADE_COLUMNS, 'grades')) {
    if (!context) {
      throw drift('grades: semester heading not found');
    }
    const { academicYear, semester } = context;
    const { rows } = readTable(table, GRADE_COLUMNS, 'grades');

    for (const row of rows) {
      const courseCode = requiredCode(row.courseCode, 'grades.courseCode');
      const classCode = row.classCode === undefined ? null : optionalText(row.classCode);
      drafts.push({
        entityType: 'grade_course',
        externalKey: [academicYear, semester, courseCode, classCode ?? ''].join('|'),
        payload: {
          academicYear,
          semester,
          courseCode,
          courseName: optionalText(row.courseName),
          classCode,
          credits: parseInteger(row.credits, 'grades.credits'),
          practiceScore: parseScore(row.practice, 'grades.practice'),
          processScore: parseScore(row.process, 'grades.process'),
          midtermScore: parseScore(row.midterm, 'grades.midterm'),
          finalExamScore: parseScore(row.final, 'grades.final'),
          totalScore: parseScore(row.total, 'grades.total'),
          totalScore4: parseScore(row.total4, 'grades.total4', 4),
          letterGrade: row.letter === undefined ? null : optionalText(row.letter),
        },
      });
    }
  }

  const summary = parseSummary(doc);
  if (summary) {
    drafts.push(summary);
  }
  return drafts;
}
