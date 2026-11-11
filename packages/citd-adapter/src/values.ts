import { drift } from './errors.js';
import { cleanText, foldText } from './text.js';

const EMPTY_FOLDED = new Set(['', 'n a', 'na', 'chua co', 'chua co diem', 'khong co']);

/** "-", "", "N/A", "(*)", "Chưa có" … mean "no value yet". */
export function isEmptyCell(raw: string | undefined): boolean {
  return EMPTY_FOLDED.has(foldText(raw));
}

/**
 * A score: number in [0, max], `null` when not published, or a short status code such as
 * "VT" (absent) or "M" (exempt). Anything else means the column mapping is wrong.
 */
export function parseScore(
  raw: string | undefined,
  field: string,
  max = 10,
): number | string | null {
  if (isEmptyCell(raw)) {
    return null;
  }
  const text = cleanText(raw).replace(',', '.');
  if (/^\d{1,2}(\.\d{1,3})?$/.test(text)) {
    const value = Number(text);
    if (value > max) {
      throw drift(`${field}: score out of range`);
    }
    return value;
  }
  if (/^\p{L}{1,8}$/u.test(text)) {
    return text.toUpperCase();
  }
  throw drift(`${field}: not a score`);
}

/** Integer VND. "1.250.000 đ", "1,250,000 VNĐ", "(100.000)" → numbers; "-" → null. */
export function parseMoney(raw: string | undefined, field: string): number | null {
  if (isEmptyCell(raw)) {
    return null;
  }
  let text = cleanText(raw)
    .replace(/(vnđ|vnd|đồng|đ)$/i, '')
    .replace(/\s/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }
  if (!/^(\d{1,3}([.,]\d{3})+|\d+)$/.test(text)) {
    throw drift(`${field}: not an amount`);
  }
  const value = Number(text.replace(/[.,]/g, ''));
  return negative ? -value : value;
}

export function parseInteger(raw: string | undefined, field: string): number | null {
  if (isEmptyCell(raw)) {
    return null;
  }
  const text = cleanText(raw);
  if (!/^\d{1,4}$/.test(text)) {
    throw drift(`${field}: not an integer`);
  }
  return Number(text);
}

/** "dd/mm/yyyy" (also "-" or "." separators) → ISO "yyyy-mm-dd". */
export function parseDate(raw: string | undefined, field: string): string | null {
  if (isEmptyCell(raw)) {
    return null;
  }
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(cleanText(raw));
  if (!match) {
    throw drift(`${field}: not a date`);
  }
  const [, day, month, year] = match as unknown as [string, string, string, string];
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCDate() !== Number(day) || date.getUTCMonth() !== Number(month) - 1) {
    throw drift(`${field}: invalid date`);
  }
  return date.toISOString().slice(0, 10);
}

/** "Thứ 2" … "Thứ 7" → 2 … 7, "Chủ nhật"/"CN" → 8 (Vietnamese weekday numbering). */
export function parseWeekday(raw: string | undefined, field: string): number {
  const folded = foldText(raw);
  const match = /^(?:thu\s*)?([2-7])$/.exec(folded);
  if (match) {
    return Number(match[1]);
  }
  if (folded === 'chu nhat' || folded === 'cn') {
    return 8;
  }
  throw drift(`${field}: not a weekday`);
}

export interface TimeSlot {
  readonly startTime: string | null;
  readonly endTime: string | null;
  /** Lesson periods ("tiết") when the Portal shows those instead of clock times. */
  readonly periods: string | null;
}

/** "07:30 - 09:30", "7h30-9h30", or "Tiết 1 - 3". */
export function parseTimeSlot(raw: string | undefined, field: string): TimeSlot {
  const text = cleanText(raw);
  const clock = /(\d{1,2})[:h](\d{2})\s*[-–]\s*(\d{1,2})[:h](\d{2})/i.exec(text);
  if (clock) {
    const [, h1, m1, h2, m2] = clock as unknown as [string, string, string, string, string];
    return {
      startTime: `${h1.padStart(2, '0')}:${m1}`,
      endTime: `${h2.padStart(2, '0')}:${m2}`,
      periods: null,
    };
  }
  const periods = /^tiet\s*(\d{1,2})\s+(\d{1,2})$/.exec(foldText(text));
  if (periods) {
    return { startTime: null, endTime: null, periods: `${periods[1]}-${periods[2]}` };
  }
  throw drift(`${field}: not a time slot`);
}

export interface TermContext {
  /** "2026-2027". */
  readonly academicYear: string;
  /** "1", "2", or "summer". */
  readonly semester: string;
}

function semesterFromFolded(folded: string): string | null {
  // "Học kỳ hè" is the summer term; "học kỳ hệ 10" (grading scale) is not.
  if (/\b(?:hoc ky|hk) he\b(?! \d)/.test(folded) || folded === 'he') {
    return 'summer';
  }
  const match = /\b(?:hoc ky|hk)\s*([1-3])\b/.exec(folded) ?? /^([1-3])$/.exec(folded);
  return match ? match[1]! : null;
}

function yearFromFolded(folded: string): string | null {
  const match = /\b(20\d{2})\s+(20\d{2})\b/.exec(folded);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    return null;
  }
  return `${match[1]}-${match[2]}`;
}

/** Finds "Học kỳ 1 … năm học 2026-2027" in a heading. `null` when the text is not one. */
export function parseTermContext(text: string): TermContext | null {
  const folded = foldText(text);
  // "hk" may be written together with the number: "HK2".
  if (!/\b(?:hoc ky|hk)(?=\s|\d|$)/.test(folded)) {
    return null;
  }
  const semester = semesterFromFolded(folded);
  const academicYear = yearFromFolded(folded);
  return semester && academicYear ? { academicYear, semester } : null;
}

/** Cell values in summary tables: "HK1", "1", "Học kỳ hè". */
export function parseSemesterCell(raw: string | undefined, field: string): string {
  const semester = semesterFromFolded(foldText(raw));
  if (!semester) {
    throw drift(`${field}: not a semester`);
  }
  return semester;
}

export function parseAcademicYearCell(raw: string | undefined, field: string): string {
  const year = yearFromFolded(foldText(raw));
  if (!year) {
    throw drift(`${field}: not an academic year`);
  }
  return year;
}

/** Optional free text (names, rooms): cleaned, `null` when empty. */
export function optionalText(raw: string | undefined): string | null {
  return isEmptyCell(raw) ? null : cleanText(raw);
}

/** Required identifier (course or class code). */
export function requiredCode(raw: string | undefined, field: string): string {
  const text = cleanText(raw);
  if (!text || isEmptyCell(text)) {
    throw drift(`${field}: missing`);
  }
  return text.toUpperCase();
}
