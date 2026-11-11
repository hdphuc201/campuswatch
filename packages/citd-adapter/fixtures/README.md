# CITD fixtures (synthetic, live structure)

Every value here is **invented test data**: no real names, student IDs, grades, amounts,
class codes, or lecturers. The page **structure** mirrors the live CITD Portal as checked
read-only with a student's own logged-in session on 2026-11-11 (paths, headings, label/value
blocks, table headers, combined cells, filter forms). No Portal page was saved or copied, and
these files contain no cookie, CSRF token, or session identifier.

| Fixture                                                                   | Portal page                                 | What it covers                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| `dashboard.html`, `dashboard-no-popup.html`                               | `/student`                                  | Logout form as the session marker; notice popup (markup assumed)        |
| `grades.html`, `grades-changed.html`                                      | `/student/academic-results`                 | "Tổng kết" label/value block; one table per "HK: N - Năm: …" heading    |
| `grades-reordered.html`, `grades-missing-column.html`, `grades-malformed.html`, `grades-empty.html` | `/student/academic-results` | Column order, drift, broken markup, no data yet |
| `tuition.html`                                                            | `/student/tuition`                          | Numbered label/value rows per term; course details left unloaded (POST) |
| `timetable.html`                                                          | `/student/timetable`                        | Semester/year filter selects; combined class and schedule cells         |
| `exams.html`, `exams-none.html`                                           | `/student/exams`                            | Filter selects, summary block, course code inside the name cell, empty  |
| `login.html`                                                              | login page                                  | Password field marks an expired session                                 |

When the Portal changes, update a fixture to the new structure with invented values (see
`docs/runbooks/citd-adapter.md`). Never commit a saved Portal page, a cookie, or a token.
