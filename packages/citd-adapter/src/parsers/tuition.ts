import type { DraftEntity } from '../draft.js';
import { drift } from '../errors.js';
import { fieldValue, type LabeledValue, readLabeledSections } from '../fields.js';
import { cellText, cleanText, foldText } from '../text.js';
import { findDates, isEmptyCell, parseCountList, parseDate, parseMoney } from '../values.js';

/**
 * Folded labels of the per-term rows ("3. Học phí" → "hoc phi"). The first label of each list
 * is the one the Portal shows today; the others are tolerated variants.
 */
export const TUITION_TERM_LABELS = {
  registeredCredits: ['so tin chi hoc phi dang ky', 'so tin chi dang ky'],
  registeredCourses: ['so mon dang ky'],
  tuitionFee: ['hoc phi', 'tong hoc phi'],
  previousDebt: ['no hoc ky truoc', 'no ky truoc'],
  amountDue: ['so tien phai dong', 'phai dong'],
  amountPaid: ['so tien da dong', 'da dong'],
  balance: ['con no', 'so tien con no'],
  dueDate: ['thoi han nop hoc phi', 'han nop hoc phi', 'han nop'],
  payment: ['thoi gian dong', 'ngay dong'],
} as const;

type TermField = keyof typeof TUITION_TERM_LABELS;
const REQUIRED: readonly TermField[] = ['amountDue', 'amountPaid', 'balance'];

function status(balance: number | null, paymentText: string): string {
  if (/qua han|tre han/.test(foldText(paymentText)) && (balance ?? 0) > 0) {
    return 'OVERDUE';
  }
  if (balance === null) {
    return 'UNKNOWN';
  }
  return balance > 0 ? 'UNPAID' : 'PAID';
}

/** "10/09/2025 (Đúng hạn)" → payment date and the Portal's own wording for its timing. */
function payment(raw: string): { paidDate: string | null; statusText: string | null } {
  const [paidDate = null] = findDates(raw, 'tuition.paidDate');
  const note = /\(([^)]+)\)/.exec(raw)?.[1] ?? raw.replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, '');
  const statusText = cleanText(note);
  return { paidDate, statusText: isEmptyCell(statusText) ? null : statusText };
}

function termDraft(
  context: { academicYear: string; semester: string },
  fields: readonly LabeledValue[],
): DraftEntity {
  const raw = Object.fromEntries(
    Object.entries(TUITION_TERM_LABELS).map(([field, aliases]) => {
      const value = fieldValue(fields, aliases);
      return [field, value ? cellText(value) : undefined];
    }),
  ) as Record<TermField, string | undefined>;
  const missing = REQUIRED.filter((field) => raw[field] === undefined);
  if (missing.length > 0) {
    throw drift(`tuition: missing fields ${missing.join(', ')}`);
  }
  const balance = parseMoney(raw.balance, 'tuition.balance');
  const paid = payment(raw.payment ?? '');
  return {
    entityType: 'tuition_term',
    externalKey: `${context.academicYear}|${context.semester}`,
    payload: {
      academicYear: context.academicYear,
      semester: context.semester,
      registeredCredits: parseCountList(raw.registeredCredits, 'tuition.registeredCredits'),
      registeredCourses: parseCountList(raw.registeredCourses, 'tuition.registeredCourses'),
      tuitionFee: parseMoney(raw.tuitionFee, 'tuition.tuitionFee'),
      previousDebt: parseMoney(raw.previousDebt, 'tuition.previousDebt'),
      amountDue: parseMoney(raw.amountDue, 'tuition.amountDue'),
      amountPaid: parseMoney(raw.amountPaid, 'tuition.amountPaid'),
      balance,
      dueDate: parseDate(raw.dueDate, 'tuition.dueDate'),
      paidDate: paid.paidDate,
      status: status(balance, raw.payment ?? ''),
      statusText: paid.statusText,
    },
  };
}

/**
 * Tuition page: one "Thông tin học phí học kỳ 1 - Năm học 2026 - 2027" block per term with
 * numbered label/value rows (fee, previous debt, amount due, paid, balance, due date, payment).
 *
 * Per-course fee details are not collected: the Portal loads them with a POST request that
 * needs a CSRF token, and the collector only makes read-only GET requests.
 */
export function parseTuition(doc: Document): DraftEntity[] {
  const terms = readLabeledSections(doc).filter((section) => section.context !== null);
  if (terms.length === 0) {
    if (/\b(chua co|khong co)\b.*\b(hoc phi|du lieu)\b/.test(foldText(doc.body?.textContent))) {
      return [];
    }
    throw drift('tuition: term sections not found');
  }
  return terms.map((section) => termDraft(section.context!, section.fields));
}
