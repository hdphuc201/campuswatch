import type { DraftEntity } from '../draft.js';
import { drift } from '../errors.js';
import {
  type ColumnSpec,
  locateTables,
  matchesSpec,
  readTable,
  requiredColumnsFound,
} from '../table.js';
import { foldText } from '../text.js';
import {
  optionalText,
  parseAcademicYearCell,
  parseDate,
  parseInteger,
  parseMoney,
  parseSemesterCell,
  requiredCode,
} from '../values.js';

type TermField =
  | 'academicYear'
  | 'semester'
  | 'tuitionFee'
  | 'previousDebt'
  | 'amountDue'
  | 'amountPaid'
  | 'balance'
  | 'dueDate'
  | 'status';

export const TUITION_TERM_COLUMNS: ColumnSpec<TermField> = {
  required: ['academicYear', 'semester', 'amountDue', 'amountPaid', 'balance'],
  aliases: {
    academicYear: ['nam hoc'],
    semester: ['hoc ky', 'hk'],
    tuitionFee: ['hoc phi', 'tong hoc phi', 'so tien hoc phi'],
    previousDebt: ['no truoc', 'no ky truoc', 'cong no truoc', 'no cu'],
    amountDue: ['phai dong', 'phai nop', 'so tien phai dong', 'tong phai dong'],
    amountPaid: ['da dong', 'da nop', 'so tien da dong'],
    balance: ['con no', 'con lai', 'so tien con no', 'con phai dong'],
    dueDate: ['han nop', 'han dong', 'han thanh toan', 'han nop hoc phi'],
    status: ['trang thai', 'tinh trang'],
  },
};

type CourseField = 'classCode' | 'courseName' | 'credits' | 'feeType' | 'amount';

export const TUITION_COURSE_COLUMNS: ColumnSpec<CourseField> = {
  required: ['classCode', 'courseName', 'amount'],
  aliases: {
    classCode: ['ma lop hoc phan', 'ma lop', 'lop hoc phan', 'ma lhp'],
    courseName: ['ten mon hoc', 'ten hoc phan', 'ten mon', 'mon hoc'],
    credits: ['so tc', 'so tin chi', 'tin chi', 'stc'],
    feeType: ['loai hoc phi', 'loai', 'hinh thuc'],
    amount: ['so tien', 'thanh tien', 'hoc phi', 'muc thu'],
  },
};

/** Portal status text → stable code. The original text is kept too, for display. */
function statusCode(raw: string | undefined): string {
  const folded = foldText(raw);
  if (/qua han|tre han/.test(folded)) {
    return 'OVERDUE';
  }
  if (/da hoan thanh|da dong du|hoan tat|da thanh toan/.test(folded)) {
    return 'PAID';
  }
  if (/con no|chua dong|chua hoan thanh|chua thanh toan/.test(folded)) {
    return 'UNPAID';
  }
  if (/dung han/.test(folded)) {
    return 'ON_TIME';
  }
  return folded ? 'OTHER' : 'UNKNOWN';
}

/**
 * Tuition page: a summary table with one row per term, and per-term detail tables listing
 * class sections and fees under "Học kỳ X năm học YYYY-YYYY" headings.
 */
export function parseTuition(doc: Document): DraftEntity[] {
  const tables = locateTables(doc);
  const terms = tables.filter((entry) => matchesSpec(entry.table, TUITION_TERM_COLUMNS));
  const details = tables.filter((entry) => matchesSpec(entry.table, TUITION_COURSE_COLUMNS));

  if (terms.length === 0) {
    if (tables.some((entry) => requiredColumnsFound(entry.table, TUITION_TERM_COLUMNS) >= 2)) {
      throw drift('tuition: summary columns changed');
    }
    if (/\b(chua co|khong co)\b.*\b(hoc phi|du lieu)\b/.test(foldText(doc.body?.textContent))) {
      return [];
    }
    throw drift('tuition: summary table not found');
  }

  const drafts: DraftEntity[] = [];
  for (const { table } of terms) {
    for (const row of readTable(table, TUITION_TERM_COLUMNS, 'tuition').rows) {
      const academicYear = parseAcademicYearCell(row.academicYear, 'tuition.academicYear');
      const semester = parseSemesterCell(row.semester, 'tuition.semester');
      drafts.push({
        entityType: 'tuition_term',
        externalKey: `${academicYear}|${semester}`,
        payload: {
          academicYear,
          semester,
          tuitionFee: parseMoney(row.tuitionFee, 'tuition.tuitionFee'),
          previousDebt: parseMoney(row.previousDebt, 'tuition.previousDebt'),
          amountDue: parseMoney(row.amountDue, 'tuition.amountDue'),
          amountPaid: parseMoney(row.amountPaid, 'tuition.amountPaid'),
          balance: parseMoney(row.balance, 'tuition.balance'),
          dueDate: parseDate(row.dueDate, 'tuition.dueDate'),
          status: statusCode(row.status),
          statusText: optionalText(row.status),
        },
      });
    }
  }

  for (const { table, context } of details) {
    if (!context) {
      throw drift('tuition: detail heading not found');
    }
    for (const row of readTable(table, TUITION_COURSE_COLUMNS, 'tuition.detail').rows) {
      const classCode = requiredCode(row.classCode, 'tuition.classCode');
      drafts.push({
        entityType: 'tuition_course',
        externalKey: `${context.academicYear}|${context.semester}|${classCode}`,
        payload: {
          academicYear: context.academicYear,
          semester: context.semester,
          classCode,
          courseName: optionalText(row.courseName),
          credits: parseInteger(row.credits, 'tuition.credits'),
          feeType: row.feeType === undefined ? null : optionalText(row.feeType),
          amount: parseMoney(row.amount, 'tuition.amount'),
        },
      });
    }
  }
  return drafts;
}
