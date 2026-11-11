import type { DraftEntity } from '../draft.js';
import { sha256Hex } from '../draft.js';
import { drift } from '../errors.js';
import { LOGGED_IN_HREF, LOGGED_IN_TEXT, LOGIN_PATH, NOTICE_POPUP_SELECTORS } from '../profile.js';
import { cellText, cleanText, foldText } from '../text.js';

const MAX_NOTICE_LENGTH = 4000;

/** True when the page is the Portal login form (session expired or never logged in). */
export function isLoginPage(doc: Document, url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = '';
  }
  return LOGIN_PATH.test(path) || doc.querySelector('input[type="password"]') !== null;
}

/** Session state from the Dashboard page. An unrecognized page is layout drift. */
export function detectSession(doc: Document, url: string): 'authenticated' | 'login_required' {
  if (isLoginPage(doc, url)) {
    return 'login_required';
  }
  const loggedIn =
    LOGGED_IN_TEXT.test(foldText(doc.body?.textContent)) ||
    Array.from(doc.querySelectorAll('a[href]')).some((link) =>
      LOGGED_IN_HREF.test(link.getAttribute('href') ?? ''),
    );
  if (!loggedIn) {
    throw drift('dashboard: session marker not found');
  }
  return 'authenticated';
}

export interface NoticeText {
  readonly title: string;
  readonly body: string;
}

/** The notice popup(s) present in the Dashboard markup. */
export function parseNoticeTexts(doc: Document): NoticeText[] {
  const containers = Array.from(doc.querySelectorAll(NOTICE_POPUP_SELECTORS.join(', ')));
  // Keep outermost containers only (".modal" usually wraps "[role=dialog]").
  const outermost = containers.filter(
    (element) => !containers.some((other) => other !== element && other.contains(element)),
  );
  const notices: NoticeText[] = [];
  for (const container of outermost) {
    const titleElement = container.querySelector(
      '.modal-title, .popup-title, .title, h1, h2, h3, h4, h5',
    );
    const title = cellText(titleElement ?? undefined);
    const bodyElement = container.querySelector('.modal-body, .popup-body, .content');
    let body = bodyElement ? cellText(bodyElement) : cellText(container);
    if (!bodyElement && title && body.startsWith(title)) {
      body = body.slice(title.length);
    }
    body = cleanText(body.replace(/\b(Đóng|Close|×)\s*$/u, '')).slice(0, MAX_NOTICE_LENGTH);
    if (title || body) {
      notices.push({ title: title.slice(0, 300), body });
    }
  }
  return notices;
}

/** Notices keyed by a hash of title + body + source (implementation plan, section 7). */
export async function noticeDrafts(notices: NoticeText[]): Promise<DraftEntity[]> {
  return Promise.all(
    notices.map(async (notice) => ({
      entityType: 'portal_notice' as const,
      externalKey: (await sha256Hex(`dashboard\u0000${notice.title}\u0000${notice.body}`)).slice(
        0,
        32,
      ),
      payload: { source: 'dashboard', title: notice.title || null, body: notice.body || null },
    })),
  );
}
