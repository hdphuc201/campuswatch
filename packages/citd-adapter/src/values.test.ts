import { describe, expect, it } from 'vitest';
import { CollectorError } from './errors.js';
import { foldText } from './text.js';
import {
  findDates,
  parseCountList,
  parseDate,
  parseDecimal,
  parseMoney,
  parseScore,
  parseSemesterCell,
  parseTermContext,
  parseTimeSlot,
  parseWeekday,
  splitCourse,
} from './values.js';

const isDrift = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch (error) {
    return error instanceof CollectorError && error.code === 'ADAPTER_NEEDS_UPDATE';
  }
};

describe('foldText', () => {
  it('removes Vietnamese diacritics and punctuation', () => {
    expect(foldText('  Điểm TK (10) ')).toBe('diem tk 10');
    expect(foldText('Học kỳ hè')).toBe('hoc ky he');
  });
});

describe('parseScore', () => {
  it('reads decimal commas and dots', () => {
    expect(parseScore('8,5', 'f')).toBe(8.5);
    expect(parseScore('10', 'f')).toBe(10);
    expect(parseScore('0', 'f')).toBe(0);
  });

  it('treats "-", blanks, and "chưa có" as not published', () => {
    for (const raw of ['-', '', '  ', '--', 'N/A', '(*)', 'Chưa có', undefined]) {
      expect(parseScore(raw, 'f')).toBeNull();
    }
  });

  it('keeps status codes such as exempt (M) or absent (VT)', () => {
    expect(parseScore('m', 'f')).toBe('M');
    expect(parseScore('VT', 'f')).toBe('VT');
  });

  it('flags values that cannot be scores as layout drift, without echoing them', () => {
    expect(isDrift(() => parseScore('15', 'grades.total'))).toBe(true);
    expect(isDrift(() => parseScore('4.5', 'grades.total4', 4))).toBe(true);
    expect(isDrift(() => parseScore('9.800.000', 'grades.total'))).toBe(true);
    try {
      parseScore('15', 'grades.total');
    } catch (error) {
      expect((error as Error).message).not.toContain('15');
    }
  });
});

describe('parseMoney', () => {
  it('returns integer VND for common formats', () => {
    expect(parseMoney('9.800.000', 'm')).toBe(9_800_000);
    expect(parseMoney('9,800,000 VNĐ', 'm')).toBe(9_800_000);
    expect(parseMoney('9.800.000 đ', 'm')).toBe(9_800_000);
    expect(parseMoney('0', 'm')).toBe(0);
    expect(parseMoney('(100.000)', 'm')).toBe(-100_000);
    expect(parseMoney('-', 'm')).toBeNull();
  });

  it('rejects decimals and text', () => {
    expect(isDrift(() => parseMoney('9.8', 'm'))).toBe(true);
    expect(isDrift(() => parseMoney('mười triệu', 'm'))).toBe(true);
  });
});

describe('dates, weekdays, times, and terms', () => {
  it('converts dd/mm/yyyy to ISO and rejects impossible dates', () => {
    expect(parseDate('5/1/2026', 'd')).toBe('2026-01-05');
    expect(parseDate('15-09-2025', 'd')).toBe('2025-09-15');
    expect(parseDate('-', 'd')).toBeNull();
    expect(isDrift(() => parseDate('31/02/2026', 'd'))).toBe(true);
    expect(isDrift(() => parseDate('2026-01-05', 'd'))).toBe(true);
  });

  it('reads Vietnamese weekdays', () => {
    expect(parseWeekday('Thứ 2', 'w')).toBe(2);
    expect(parseWeekday('7', 'w')).toBe(7);
    expect(parseWeekday('Chủ nhật', 'w')).toBe(8);
    expect(parseWeekday('CN', 'w')).toBe(8);
    expect(isDrift(() => parseWeekday('Thứ 9', 'w'))).toBe(true);
  });

  it('reads clock ranges and lesson periods', () => {
    expect(parseTimeSlot('7h30 - 9h30', 't')).toEqual({
      startTime: '07:30',
      endTime: '09:30',
      periods: null,
    });
    expect(parseTimeSlot('Tiết 1 - 3', 't')).toEqual({
      startTime: null,
      endTime: null,
      periods: '1-3',
    });
  });

  it('finds term headings but not grading-scale labels', () => {
    expect(parseTermContext('Học kỳ 1 - Năm học 2025-2026')).toEqual({
      academicYear: '2025-2026',
      semester: '1',
    });
    expect(parseTermContext('HK2 2025 - 2026')).toEqual({
      academicYear: '2025-2026',
      semester: '2',
    });
    expect(parseTermContext('Học kỳ hè năm học 2025-2026')?.semester).toBe('summer');
    expect(parseTermContext('Điểm trung bình học kỳ hệ 10: 8,44')).toBeNull();
    expect(parseTermContext('Học kỳ 1 năm học 2025-2027')).toBeNull();
    expect(parseSemesterCell('Hè', 's')).toBe('summer');
  });
});

describe('values used by the live Portal layout', () => {
  it('parses GPA-style decimals within range', () => {
    expect(parseDecimal('8.44', 'g', 10)).toBe(8.44);
    expect(parseDecimal('8,44', 'g', 10)).toBe(8.44);
    expect(parseDecimal('-', 'g', 10)).toBeNull();
    expect(isDrift(() => parseDecimal('84.4', 'g', 10))).toBe(true);
    expect(isDrift(() => parseDecimal('abc', 'g', 10))).toBe(true);
  });

  it('sums registration counts', () => {
    expect(parseCountList('Học mới (12), Học cải thiện (3)', 'c')).toBe(15);
    expect(parseCountList('Học mới (4)', 'c')).toBe(4);
    expect(parseCountList('7', 'c')).toBe(7);
    expect(isDrift(() => parseCountList('Học mới', 'c'))).toBe(true);
  });

  it('finds every date in a text', () => {
    expect(findDates('05/01/2026 – 15/05/2026', 'd')).toEqual(['2026-01-05', '2026-05-15']);
    expect(findDates('Chưa đóng', 'd')).toEqual([]);
  });

  it('splits "CODE Course name"', () => {
    expect(splitCourse('cs102 Cấu trúc dữ liệu')).toEqual({
      code: 'CS102',
      name: 'Cấu trúc dữ liệu',
    });
    expect(splitCourse('EN101')).toEqual({ code: 'EN101', name: null });
    expect(splitCourse('Giải tích 1')).toBeNull();
  });
});
