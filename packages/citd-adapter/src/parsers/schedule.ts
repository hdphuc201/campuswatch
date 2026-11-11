import type { DraftEntity } from '../draft.js';
import { drift } from '../errors.js';
import { type ColumnSpec, findDataTables, readTable } from '../table.js';
import {
  optionalText,
  parseDate,
  parseTimeSlot,
  parseWeekday,
  requiredCode,
  type TermContext,
} from '../values.js';

type TimetableField =
  | 'classCode'
  | 'courseName'
  | 'weekday'
  | 'time'
  | 'room'
  | 'lecturer'
  | 'startDate'
  | 'endDate'
  | 'feeType';

export const TIMETABLE_COLUMNS: ColumnSpec<TimetableField> = {
  required: ['classCode', 'courseName', 'weekday', 'time'],
  aliases: {
    classCode: ['ma lop hoc phan', 'ma lop', 'lop hoc phan', 'ma lhp'],
    courseName: ['ten mon hoc', 'ten hoc phan', 'ten mon', 'mon hoc'],
    weekday: ['thu', 'ngay trong tuan'],
    time: ['gio hoc', 'thoi gian', 'tiet', 'tiet hoc', 'ca hoc'],
    room: ['phong', 'phong hoc'],
    lecturer: ['giang vien', 'gv', 'giao vien'],
    startDate: ['tu ngay', 'ngay bat dau', 'bat dau'],
    endDate: ['den ngay', 'ngay ket thuc', 'ket thuc'],
    feeType: ['loai hoc phi'],
  },
};

type ExamField =
  'courseCode' | 'courseName' | 'classCode' | 'date' | 'shift' | 'time' | 'room' | 'examType';

export const EXAM_COLUMNS: ColumnSpec<ExamField> = {
  required: ['courseCode', 'courseName', 'date'],
  aliases: {
    courseCode: ['ma mon hoc', 'ma mh', 'ma hoc phan', 'ma mon'],
    courseName: ['ten mon hoc', 'ten hoc phan', 'ten mon', 'mon hoc', 'mon thi'],
    classCode: ['lop hoc phan', 'ma lop', 'lop'],
    date: ['ngay thi'],
    shift: ['ca thi', 'ca'],
    time: ['gio thi', 'gio bat dau', 'thoi gian'],
    room: ['phong thi', 'phong'],
    examType: ['hinh thuc', 'hinh thuc thi'],
  },
};

const termKey = (context: TermContext | null) =>
  context ? `${context.academicYear}|${context.semester}` : 'current';

/** Timetable page: one row per weekly class meeting. */
export function parseTimetable(doc: Document): DraftEntity[] {
  const drafts: DraftEntity[] = [];
  for (const { table, context } of findDataTables(doc, TIMETABLE_COLUMNS, 'timetable')) {
    if (!context) {
      throw drift('timetable: semester not found');
    }
    for (const row of readTable(table, TIMETABLE_COLUMNS, 'timetable').rows) {
      const classCode = requiredCode(row.classCode, 'timetable.classCode');
      const weekday = parseWeekday(row.weekday, 'timetable.weekday');
      const slot = parseTimeSlot(row.time, 'timetable.time');
      drafts.push({
        entityType: 'timetable_class',
        // A class can meet several times a week, so the meeting slot is part of the key.
        externalKey: [
          termKey(context),
          classCode,
          weekday,
          slot.startTime ?? `p${slot.periods}`,
        ].join('|'),
        payload: {
          academicYear: context.academicYear,
          semester: context.semester,
          classCode,
          courseName: optionalText(row.courseName),
          weekday,
          startTime: slot.startTime,
          endTime: slot.endTime,
          periods: slot.periods,
          room: row.room === undefined ? null : optionalText(row.room),
          lecturer: row.lecturer === undefined ? null : optionalText(row.lecturer),
          startDate: parseDate(row.startDate, 'timetable.startDate'),
          endDate: parseDate(row.endDate, 'timetable.endDate'),
          feeType: row.feeType === undefined ? null : optionalText(row.feeType),
        },
      });
    }
  }
  return drafts;
}

/** "08:00", "8h00", or a "08:00 - 09:30" range → "08:00"; empty → null. */
function examStartTime(raw: string | undefined): string | null {
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

/** Exam schedule page. "Chưa có lịch thi" (no schedule yet) yields an empty list. */
export function parseExams(doc: Document): DraftEntity[] {
  const drafts: DraftEntity[] = [];
  for (const { table, context } of findDataTables(doc, EXAM_COLUMNS, 'exams')) {
    for (const row of readTable(table, EXAM_COLUMNS, 'exams').rows) {
      const courseCode = requiredCode(row.courseCode, 'exams.courseCode');
      const date = parseDate(row.date, 'exams.date');
      const shift = row.shift === undefined ? null : optionalText(row.shift);
      const slot = examStartTime(row.time);
      drafts.push({
        entityType: 'exam',
        externalKey: [termKey(context), courseCode, date ?? 'tba', shift ?? slot ?? ''].join('|'),
        payload: {
          academicYear: context?.academicYear ?? null,
          semester: context?.semester ?? null,
          courseCode,
          courseName: optionalText(row.courseName),
          classCode: row.classCode === undefined ? null : optionalText(row.classCode),
          date,
          shift,
          startTime: slot,
          room: row.room === undefined ? null : optionalText(row.room),
          examType: row.examType === undefined ? null : optionalText(row.examType),
        },
      });
    }
  }
  return drafts;
}
