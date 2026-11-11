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

Paths, markers, and fixtures are a **synthetic baseline**. `citdCapabilities.liveVerified`
is `false`, and the popup labels Portal reading as beta. Verifying against the live Portal
requires a student's own account and is recorded as `BLOCKED_EXTERNAL` until done
(see `docs/runbooks/citd-adapter.md`).

## Consequences

- Header-based parsing tolerates cosmetic changes; real layout changes surface as
  `ADAPTER_NEEDS_UPDATE` instead of silently wrong data.
- When the student has no Portal tab open, a background tab appears briefly during a sync.
- The `scripting` permission is added; host access stays limited to the Portal and the API.
