import type { PortalDataSource } from '@campuswatch/portal-core';

/**
 * Everything CITD-specific about where data lives. Parsers locate tables by header text and
 * summary values by their labels (see ./parsers), so only these paths and markers are
 * layout-bound.
 *
 * VERIFICATION STATUS: paths and page structure were checked read-only against the live Portal
 * with a student's own logged-in session on 2026-11-11. The fixtures in ../fixtures mirror that
 * structure with invented values. No Portal page, value, cookie, or token is stored here.
 */
export const CITD_ORIGIN = 'https://portal.citd.edu.vn';

export const CITD_PAGE_PATHS: Readonly<Record<'dashboard' | PortalDataSource, string>> = {
  dashboard: '/student',
  grades: '/student/academic-results',
  tuition: '/student/tuition',
  timetable: '/student/timetable',
  exams: '/student/exams',
  dashboardNotices: '/student',
};

/** A response URL matching this is the login page: the session has expired. */
export const LOGIN_PATH = /\/(account\/)?(login|dang-?nhap)\b/i;

/** Signs of a logged-in page (folded text or link targets). */
export const LOGGED_IN_TEXT = /\b(dang xuat|logout|sign out)\b/;
export const LOGGED_IN_HREF = /logout|dang-?xuat/i;

/** Containers that hold the Dashboard notice popup. */
export const NOTICE_POPUP_SELECTORS = [
  '[role="dialog"]',
  '.modal',
  '.popup',
  '#popup',
  '#thongbao',
] as const;
