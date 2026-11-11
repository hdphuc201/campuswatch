import type { PortalDataSource } from '@campuswatch/portal-core';

/**
 * Everything CITD-specific about where data lives. Parsers locate tables by header text
 * (see the column specs in ./parsers), so only these paths and markers are layout-bound.
 *
 * VERIFICATION STATUS: no Portal discovery capture is in this repository. These paths and the
 * fixtures in ../fixtures are a synthetic baseline. They must be checked read-only against the
 * live Portal by a student with their own account before the pilot (see docs/AUTOPILOT_STATUS.md).
 */
export const CITD_ORIGIN = 'https://portal.citd.edu.vn';

export const CITD_PAGE_PATHS: Readonly<Record<'dashboard' | PortalDataSource, string>> = {
  dashboard: '/',
  grades: '/SinhVien/KetQuaHocTap',
  tuition: '/SinhVien/HocPhi',
  timetable: '/SinhVien/ThoiKhoaBieu',
  exams: '/SinhVien/LichThi',
  dashboardNotices: '/',
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
