# Runbook: pilot support

## Channels

One shared support address or chat for the pilot (5–20 students). Response target: same
school day. Never ask for or accept a Portal password, cookie, or screenshot showing grades or
amounts; ask students to blur personal data.

## Common questions

| Student reports                                    | Likely cause                                                                         | Answer                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| "Log in to the CITD Portal"                        | Portal session expired                                                               | Open the Portal in Chrome and log in; CampusWatch resumes automatically.                            |
| "Portal reading not available" / "needs an update" | Portal layout changed (`ADAPTER_NEEDS_UPDATE`)                                       | We are fixing it; check the Portal directly meanwhile. Escalate to engineering (`citd-adapter.md`). |
| "Cannot reach CampusWatch"                         | API down or student offline                                                          | Check `/health/ready`; retries are automatic.                                                       |
| No notifications                                   | Category disabled, quiet hours, Chrome notifications blocked by OS, or Chrome closed | Check Settings and data; OS notification settings; CampusWatch only checks while Chrome runs.       |
| Telegram stopped                                   | Bot blocked or chat deleted (auto-unlinked)                                          | Link Telegram again.                                                                                |
| "Too many attempts"                                | Rate limit                                                                           | Wait up to 15 minutes.                                                                              |
| Wants their data removed                           | —                                                                                    | Settings and data → Delete my data / Delete my account (`privacy-requests.md`).                     |
| Notification looks wrong                           | Portal shows different data                                                          | Ask what the Portal shows (no screenshots of grades needed); check parser fixtures.                 |

## Escalation

- Engineering: parser drift, 5xx errors, delivery backlog (see `observability.md`).
- Security incident (any sign one student saw another's data): `incident-response.md`
  immediately.

## Weekly pilot review

Sync success rate (target ≥ 95 % while the Portal is healthy), duplicate notifications
(< 1 %), cross-user incidents (0), log incidents (0), drift detections, and student feedback.
