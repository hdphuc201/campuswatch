# ADR-0004: Read-only CITD collectors

- **Status:** Accepted
- **Date:** 2026-11-11
- **Phase:** P4 (implementation plan, sections 6.2, 7, and 13)

## Context

The extension must read grades, tuition, timetable, exams, and Dashboard notices from the
student's own logged-in Portal session, without storing or sending Portal credentials,
cookies, or HTML. No Portal discovery capture (saved pages) exists in this repository, so
the exact markup is unknown.

## Decision

### Where code runs

- `@campuswatch/citd-adapter` holds everything CITD-specific: page paths and login markers
  (`profile.ts`), value normalization, table reading, page parsers, and `runCollector`.
- The background service worker injects the bundled collector (`/citd-collector.js`, an
  unlisted script, never a declared content script) into a Portal tab with
  `chrome.scripting`. It reuses an open Portal tab, or opens one in the background and
  closes it when the run ends.
- Inside the tab the collector issues same-origin `GET` requests with the tab's existing
  session, parses the HTML with `DOMParser`, and returns only normalized, fingerprinted
  entities. It never submits forms, never logs in, and never sends data anywhere.
- The background validates every returned entity against the shared Zod contract (strict
  objects, flat payloads, at most 5000 per source) before using it.

### Parsing strategy

Tables are found by **header text**, folded to lowercase ASCII without diacritics, with
aliases per field ("Mã môn học", "Mã MH", "Mã học phần" …). Grouped two-row headers are
resolved to their bottom labels. Extra or reordered columns therefore keep working; a table
with only some of the required columns is reported as drift. Term context comes from the
nearest preceding "Học kỳ … năm học …" heading, caption, or selected `<option>`.

Normalization: scores to numbers in [0, 10] (or [0, 4]), "-"/blank/"Chưa có" to `null`,
short status codes ("M", "VT") kept as text; money to integer VND; dates to ISO
`yyyy-mm-dd`; weekdays to 2–8; academic year to "2025-2026"; semester to "1", "2", or
"summer". An impossible value (a score of 79, a date of 31/02) is drift, not data.

External keys follow plan section 7. Timetable rows add weekday and start time because a
class meets several times a week. Notices are keyed by a SHA-256 of source + title + body.

### Error classification

| Situation                                                           | Code                   |
| ------------------------------------------------------------------- | ---------------------- |
| Login page, redirect to login, HTTP 401/403                         | `LOGIN_REQUIRED`       |
| HTTP 5xx/429, timeout, tab cannot load                              | `PORTAL_UNAVAILABLE`   |
| `fetch` fails                                                       | `NETWORK_ERROR`        |
| Missing/changed columns, unknown page, invalid values, bad response | `ADAPTER_NEEDS_UPDATE` |

Error details name pages and fields only. Unknown exceptions are reported as
"unexpected parser error" so page content can never leak through an error message.

### Verification status

The first version used a synthetic baseline and failed on the live Portal: every guessed path
returned 404 (`ADAPTER_NEEDS_UPDATE`). On 2026-11-11 the page structure was checked read-only
with a student's own logged-in session, and the collectors were updated (see the amendment
below). `citdCapabilities.liveVerified` stays `false` until a full **Sync now** in the
extension succeeds (see `docs/runbooks/citd-adapter.md`).

### Amendment (2026-11-11): live Portal layout

- Paths are under `/student` (`/student/academic-results`, `/student/tuition`,
  `/student/timetable`, `/student/exams`).
- Summary values are not in tables but in **label/value pairs** (a label element followed by
  its value element). `readLabeledSections` reads them in document order, grouped under the
  term headings before them, matching folded labels without their list numbers.
- Grades: one `grade_summary` keyed `cumulative` from the "Tổng kết" block (`gpa10`,
  `overallGpa10`, `creditsAccumulated`, `creditsAttempted`). The Portal shows no per-semester
  GPA, so none is emitted.
- Tuition: one `tuition_term` per term block, with `paidDate` and the Portal's timing note
  (`statusText`); `status` comes from the balance. **`tuition_course` is not collected:** the
  Portal loads course fees with a `POST` request that needs a CSRF token, and the collector
  only makes read-only `GET` requests.
- Timetable and exams show one semester at a time; the term comes from the selected options
  of the page's `GET` filter form (falling back to "Học kỳ"/"Năm học" label/value pairs).
  Combined cells are split by line (class code / "CODE Course name"; "Thứ 2, 18h15 - 21h00" /
  date range). A class without a weekly slot is kept once with a null weekday.

## Consequences

- Header-based parsing tolerates cosmetic changes; real layout changes surface as
  `ADAPTER_NEEDS_UPDATE` instead of silently wrong data.
- When the student has no Portal tab open, a background tab appears briefly during a sync.
- The `scripting` permission is added; host access stays limited to the Portal and the API.
