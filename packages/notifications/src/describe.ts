import type { CanonicalValue, ChangeEvent } from '@campuswatch/contracts';

export interface ChangeDescription {
  readonly title: string;
  readonly details: string[];
}

type DescribableChange = Pick<
  ChangeEvent,
  'entityType' | 'externalKey' | 'kind' | 'changedFields' | 'payload'
>;

const FIELD_LABELS: Record<string, string> = {
  totalScore: 'Total score',
  totalScore4: 'Total (4-point)',
  finalExamScore: 'Final exam',
  midtermScore: 'Midterm',
  processScore: 'Coursework',
  practiceScore: 'Practical',
  letterGrade: 'Letter grade',
  credits: 'Credits',
  gpa10: 'GPA',
  gpa4: 'GPA (4-point)',
  creditsEarned: 'Credits earned',
  creditsAccumulated: 'Credits accumulated',
  amountDue: 'Amount due',
  amountPaid: 'Paid',
  balance: 'Balance',
  dueDate: 'Due date',
  status: 'Status',
  amount: 'Amount',
  room: 'Room',
  date: 'Date',
  startTime: 'Start',
  endTime: 'End',
  shift: 'Session',
  weekday: 'Day',
  lecturer: 'Lecturer',
};

const MONEY_FIELDS = new Set([
  'amountDue',
  'amountPaid',
  'balance',
  'amount',
  'tuitionFee',
  'previousDebt',
]);
const IGNORED_FIELDS = new Set(['statusText', 'academicYear', 'semester']);

function formatValue(field: string, value: CanonicalValue | undefined): string {
  if (value === undefined || value === null) {
    return '—';
  }
  if (typeof value === 'number' && MONEY_FIELDS.has(field)) {
    return `${value.toLocaleString('vi-VN')} ₫`;
  }
  if (field === 'weekday' && typeof value === 'number') {
    return value === 8 ? 'Sunday' : `Thứ ${value}`;
  }
  return String(value);
}

function text(value: CanonicalValue | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'string' ? value : String(value);
}

function subject(change: DescribableChange): string {
  const p = change.payload;
  switch (change.entityType) {
    case 'grade_course':
      return `${text(p.courseCode)} ${text(p.courseName)}`.trim();
    case 'grade_summary':
      return change.externalKey === 'cumulative'
        ? 'Cumulative GPA'
        : `GPA ${text(p.academicYear)} semester ${text(p.semester)}`;
    case 'tuition_term':
      return `Tuition ${text(p.academicYear)} semester ${text(p.semester)}`;
    case 'tuition_course':
      return `Tuition item ${text(p.classCode)} ${text(p.courseName)}`.trim();
    case 'timetable_class':
      return `Class ${text(p.classCode)} ${text(p.courseName)}`.trim();
    case 'exam':
      return `Exam ${text(p.courseCode)} ${text(p.courseName)}`.trim();
    case 'portal_notice':
      return `Portal notice: ${text(p.title) || 'untitled'}`;
  }
}

/** Detailed, plain-language description of one change (contains the student's data). */
export function describeChange(change: DescribableChange): ChangeDescription {
  const what = subject(change);
  const title =
    change.kind === 'ADDED'
      ? `New: ${what}`
      : change.kind === 'REMOVED'
        ? `Removed: ${what}`
        : `Updated: ${what}`;
  const details =
    change.kind === 'UPDATED'
      ? change.changedFields
          .filter((field) => !IGNORED_FIELDS.has(field.field))
          .map(
            (field) =>
              `${FIELD_LABELS[field.field] ?? field.field}: ${formatValue(field.field, field.before)} → ${formatValue(field.field, field.after)}`,
          )
      : [];
  return { title, details };
}
