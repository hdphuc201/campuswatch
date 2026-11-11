import type { CanonicalPayload } from '@campuswatch/contracts';
import type { DraftEntity } from '../draft.js';
import { drift } from '../errors.js';
import { type ColumnSpec, findDataTables, readTable } from '../table.js';
import { foldText } from '../text.js';
import { optionalText, parseInteger, parseScore, requiredCode } from '../values.js';

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

const NUMBER = String.raw`(\d{1,2}(?:[.,]\d{1,3})?)`;
const SUMMARY_PATTERNS = {
  gpa10: new RegExp(String.raw`diem trung binh hoc ky(?: he 10)? ${NUMBER}`),
  gpa4: new RegExp(String.raw`diem trung binh hoc ky he 4 ${NUMBER}`),
  creditsEarned: /so tin chi dat hoc ky (\d{1,3})/,
  cumulativeGpa10: new RegExp(String.raw`diem trung binh tich luy(?: he 10)? ${NUMBER}`),
  cumulativeGpa4: new RegExp(String.raw`diem trung binh tich luy he 4 ${NUMBER}`),
  cumulativeCredits: /so tin chi tich luy (\d{1,3})/,
} as const;

/** Summary numbers are folded with the text, so "7,85" becomes "7 85" — rebuild it. */
function summaryNumber(text: string, pattern: RegExp, max: number): number | null {
  const loose = new RegExp(pattern.source.replace(NUMBER, String.raw`(\d{1,2})(?: (\d{1,3}))?`));
  const match = loose.exec(text);
  if (!match) {
    return null;
  }
  const value = Number(match[2] ? `${match[1]}.${match[2]}` : match[1]);
  if (value > max) {
    throw drift('grades.summary: value out of range');
  }
  return value;
}

/**
 * Grades page: one table per semester under a "Học kỳ X năm học YYYY-YYYY" heading, followed
 * by semester and cumulative GPA lines.
 */
export function parseGrades(doc: Document): DraftEntity[] {
  const drafts: DraftEntity[] = [];
  let cumulative: CanonicalPayload | null = null;

  for (const { table, context, trailingText } of findDataTables(doc, GRADE_COLUMNS, 'grades')) {
    if (!context) {
      throw drift('grades: semester heading not found');
    }
    const { academicYear, semester } = context;
    const { rows, extraText } = readTable(table, GRADE_COLUMNS, 'grades');

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

    const summaryText = foldText(`${extraText} ${trailingText}`);
    const gpa10 = summaryNumber(summaryText, SUMMARY_PATTERNS.gpa10, 10);
    const gpa4 = summaryNumber(summaryText, SUMMARY_PATTERNS.gpa4, 4);
    const creditsEarned = summaryNumber(summaryText, SUMMARY_PATTERNS.creditsEarned, 999);
    if (gpa10 !== null || gpa4 !== null || creditsEarned !== null) {
      drafts.push({
        entityType: 'grade_summary',
        externalKey: `${academicYear}|${semester}`,
        payload: { academicYear, semester, gpa10, gpa4, creditsEarned },
      });
    }
    const cumulativeGpa10 = summaryNumber(summaryText, SUMMARY_PATTERNS.cumulativeGpa10, 10);
    const cumulativeGpa4 = summaryNumber(summaryText, SUMMARY_PATTERNS.cumulativeGpa4, 4);
    const cumulativeCredits = summaryNumber(summaryText, SUMMARY_PATTERNS.cumulativeCredits, 999);
    if (cumulativeGpa10 !== null || cumulativeGpa4 !== null || cumulativeCredits !== null) {
      // Pages list semesters oldest first; the last block holds the current cumulative values.
      cumulative = {
        gpa10: cumulativeGpa10,
        gpa4: cumulativeGpa4,
        creditsAccumulated: cumulativeCredits,
      };
    }
  }

  if (cumulative) {
    drafts.push({ entityType: 'grade_summary', externalKey: 'cumulative', payload: cumulative });
  }
  return drafts;
}
