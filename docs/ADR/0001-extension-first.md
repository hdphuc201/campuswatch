# ADR-0001: Extension-first MVP without stored Portal credentials

- **Status:** Accepted
- **Date:** 2026-11-11
- **Source:** `docs/CAMPUSWATCH_OFFICIAL_IMPLEMENTATION_PLAN.md` (sections 1, 2, 11, 13, and 16)

## Context

CampusWatch notifies students when their academic data on the CITD Portal changes: grades,
tuition, timetable, exams, and dashboard notices. Many students will use it, each with their
own Portal account.

Polling the Portal from a server would need each student's Portal password or session cookie
on our infrastructure. That creates a high-value credential store, depends on CITD's
permission and rate limits, and has not been through discovery or security review.

## Decision

1. **Extension-first MVP.** A Chrome Extension (Manifest V3) reads Portal pages inside the
   student's own logged-in Chrome session, normalizes the data, and sends only normalized
   entities to the CampusWatch API. The shared Backend stores history, computes changes, and
   delivers notifications.
2. **No Portal secrets on the Backend.** The Backend never receives or stores Portal
   passwords, cookies, or CSRF tokens. Raw HTML/DOM is never sent to the Backend, logs,
   telemetry, or Telegram. The Extension does not request the `cookies` permission and does
   not automate Portal login. All Portal access is read-only.
3. **No always-on promise.** Monitoring runs only while Chrome is running on the student's
   computer (about every 30 minutes with jitter). The product must not claim monitoring while
   Chrome or the computer is off, and onboarding states this limit clearly.
4. **Cloud polling is out of scope.** Server-side polling requires a separate, approved
   discovery (CITD permission, API/session behavior, rate limits) and a security review,
   recorded in its own decision record (phase P9). It is never enabled by default.

## Consequences

- No credential vault is needed, and a Backend breach cannot expose Portal logins.
- Coverage gaps are expected when a student's Chrome is closed; the UI must show the last
  successful sync time and health state rather than implying continuous coverage.
- Collectors depend on Portal page structure, so parser drift must be detected and surfaced
  (`ADAPTER_NEEDS_UPDATE`).
- An expired Portal session stops polling and asks the student to log in again
  (`LOGIN_REQUIRED`); there is no automatic re-login.
- Revisiting any of points 2-4 requires a new ADR that supersedes this one.
