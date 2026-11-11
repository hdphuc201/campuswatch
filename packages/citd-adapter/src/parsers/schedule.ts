import type { DraftEntity } from '../draft.js';
import { drift } from '../errors.js';
import { selectedTerm } from '../fields.js';
import { type ColumnSpec, findDataTables, readTable } from '../table.js';
import { cellText, cleanText, foldText } from '../text.js';
import {
  findDates,
  optionalText,
  parseInteger,
  parseTimeSlot,
  parseWeekday,
  requiredCode,
  splitCourse,
  type TermContext,
} from '../values.js';

type TimetableField = 'classCourse' | 'schedule' | 'credits' | 'feeType' | 'lecturer' | 'room';

/**
 * The timetable list: "Lớp / Môn học" holds the class code and "CODE Course name" as two lines,
 * "Lịch học / Thời gian" holds "Thứ 2, 18h15 - 21h00" and "dd/mm/yyyy – dd/mm/yyyy".
 */
export const TIMETABLE_COLUMNS: ColumnSpec<TimetableField> = {
  required: ['classCourse', 'schedule'],
  aliases: {
    classCourse: ['lop mon hoc', 'lop hoc phan mon hoc'],
    schedule: ['lich hoc thoi gian', 'lich hoc', 'thoi gian hoc'],
    credits: ['so tin chi', 'so tc', 'tin chi'],
    feeType: ['loai hoc phi'],
    lecturer: ['giang vien', 'gv'],
    room: ['phong', 'phong hoc'],
  },
};

type ExamField =
  | 'classCode'
  | 'course'
  | 'courseCode'
  | 'credits'
  | 'lecturer'
  | 'date'
  | 'shift'
  | 'time'
  | 'room'
  | 'feeType'
  | 'examType';

/** The exam list: "Tên môn" holds the course code (its own element) and the course name. */
export const EXAM_COLUMNS: ColumnSpec<ExamField> = {
  required: ['course', 'date'],
  aliases: {
    classCode: ['ma lop', 'ma lop hoc phan', 'lop hoc phan'],
    course: ['ten mon', 'ten mon hoc', 'mon hoc', 'mon thi'],
    courseCode: ['ma mon hoc', 'ma mon', 'ma mh'],
    credits: ['tin chi', 'so tin chi', 'so tc'],
    lecturer: ['giang vien', 'gv'],
    date: ['ngay thi'],
    shift: ['ca thi', 'ca'],
    time: ['gio thi', 'gio bat dau'],
    room: ['phong thi', 'phong'],
    feeType: ['loai hoc phi'],
    examType: ['hinh thuc thi', 'hinh thuc'],
  },
};

const termKey = (context: TermContext) => `${context.academicYear}|${context.semester}`;

/** Text lines of a cell: its block children (`<p>`, `<div>`), or the whole cell. */
function cellLines(cell: Element | undefined): string[] {
  if (!cell) {
    return [];
  }
  const blocks = Array.from(cell.children).filter((child) => /^(P|DIV|LI)$/.test(child.tagName));
  const lines = (blocks.length > 0 ? blocks : [cell]).map((block) => cellText(block));
  return lines.filter((line) => line !== '');
}

const WEEKDAY_LINE = /^(thu [2-7]|chu nhat|cn)\b/;

interface Meeting {
  readonly weekday: number;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly periods: string | null;
}

/** "Thứ 2, 18h15 - 21h00" lines of a schedule cell. */
function meetings(lines: readonly string[]): Meeting[] {
  return lines
    .filter((line) => WEEKDAY_LINE.test(foldText(line)))
    .map((line) => {
      const comma = line.indexOf(',');
      if (comma < 0) {
        throw drift('timetable: schedule not recognized');
      }
      return {
        weekday: parseWeekday(line.slice(0, comma), 'timetable.weekday'),
        ...parseTimeSlot(line.slice(comma + 1), 'timetable.time'),
      };
    });
}

/** Timetable page (list view): one row per class, for the semester selected in the filter. */
export function parseTimetable(doc: Document): DraftEntity[] {
  const tables = findDataTables(doc, TIMETABLE_COLUMNS, 'timetable');
  if (tables.length === 0) {
    return [];
  }
  const context = selectedTerm(doc, 'timetable');
  const drafts: DraftEntity[] = [];
  for (const { table } of tables) {
    const { rows, cells } = readTable(table, TIMETABLE_COLUMNS, 'timetable');
    rows.forEach((row, index) => {
      const [classLine, courseLine] = cellLines(cells[index]!.classCourse);
      const classCode = requiredCode(classLine, 'timetable.classCode');
      const course = splitCourse(courseLine);
      const scheduleLines = cellLines(cells[index]!.schedule);
      const [startDate = null, endDate = null] = findDates(
        scheduleLines.join(' '),
        'timetable.dates',
      );
      const found = meetings(scheduleLines);
      if (found.length === 0 && scheduleLines.some((line) => /\d/.test(line))) {
        throw drift('timetable: schedule not recognized');
      }
      // A class without a fixed weekly slot is still listed, once.
      const slots: (Meeting | null)[] = found.length > 0 ? found : [null];
      for (const meeting of slots) {
        drafts.push({
          entityType: 'timetable_class',
          externalKey: [
            termKey(context),
            classCode,
            meeting?.weekday ?? 'unscheduled',
            meeting ? (meeting.startTime ?? `p${meeting.periods}`) : '',
          ].join('|'),
          payload: {
            academicYear: context.academicYear,
            semester: context.semester,
            classCode,
            courseCode: course?.code ?? null,
            courseName: course ? course.name : optionalText(courseLine),
            credits: parseInteger(row.credits, 'timetable.credits'),
            weekday: meeting?.weekday ?? null,
            startTime: meeting?.startTime ?? null,
            endTime: meeting?.endTime ?? null,
            periods: meeting?.periods ?? null,
            room: row.room === undefined ? null : optionalText(row.room),
            lecturer: row.lecturer === undefined ? null : optionalText(row.lecturer),
            startDate,
            endDate,
            feeType: row.feeType === undefined ? null : optionalText(row.feeType),
          },
        });
      }
    });
  }
  return drafts;
}

/** "08:00", "8h00", or a "08:00 - 09:30" range → "08:00"; empty → null. */
export function examStartTime(raw: string | undefined): string | null {
  const text = optionalText(raw);
  if (text === null) {
    return null;
  }
  const single = /^(\d{1,2})[:h](\d{2})$/i.exec(text);
  if (single) {
    return `${single[1]!.padStart(2, '0')}:${single[2]}`;
  }
  return parseTimeSlot(text, 'exams.time').startTime;
}

/** Course code and name from the "Tên môn" cell: the code is its own element, or a prefix. */
function examCourse(cell: Element | undefined): { code: string | null; name: string | null } {
  const text = cellText(cell);
  const codeElement = Array.from(cell?.children ?? []).find(
    (child) => splitCourse(cellText(child))?.name === null,
  );
  if (codeElement) {
    const code = cellText(codeElement);
    return { code: code.toUpperCase(), name: optionalText(cleanText(text.replace(code, ''))) };
  }
  const split = splitCourse(text);
  return split ? { code: split.code, name: split.name } : { code: null, name: optionalText(text) };
}

/** Exam schedule page for the semester selected in the filter. "Chưa có lịch thi" → []. */
export function parseExams(doc: Document): DraftEntity[] {
  const tables = findDataTables(doc, EXAM_COLUMNS, 'exams');
  if (tables.length === 0) {
    return [];
  }
  const context = selectedTerm(doc, 'exams');
  const drafts: DraftEntity[] = [];
  for (const { table } of tables) {
    const { rows, cells } = readTable(table, EXAM_COLUMNS, 'exams');
    rows.forEach((row, index) => {
      const course = examCourse(cells[index]!.course);
      const courseCode =
        row.courseCode === undefined
          ? requiredCode(course.code ?? undefined, 'exams.courseCode')
          : requiredCode(row.courseCode, 'exams.courseCode');
      const [date = null] = findDates(row.date, 'exams.date');
      if (date === null && optionalText(row.date) !== null) {
        throw drift('exams.date: not a date');
      }
      const shift = row.shift === undefined ? null : optionalText(row.shift);
      const startTime = examStartTime(row.time);
      drafts.push({
        entityType: 'exam',
        externalKey: [termKey(context), courseCode, date ?? 'tba', shift ?? startTime ?? ''].join(
          '|',
        ),
        payload: {
          academicYear: context.academicYear,
          semester: context.semester,
          courseCode,
          courseName: course.name,
          classCode: row.classCode === undefined ? null : optionalText(row.classCode),
          credits: parseInteger(row.credits, 'exams.credits'),
          lecturer: row.lecturer === undefined ? null : optionalText(row.lecturer),
          date,
          shift,
          startTime,
          room: row.room === undefined ? null : optionalText(row.room),
          feeType: row.feeType === undefined ? null : optionalText(row.feeType),
          examType: row.examType === undefined ? null : optionalText(row.examType),
        },
      });
    });
  }
  return drafts;
}
