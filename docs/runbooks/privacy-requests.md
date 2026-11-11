# Runbook: privacy requests (export, deletion, consent)

Students can do all of this themselves in the extension (**Settings and data → Your
data**), each action confirmed with their CampusWatch password:

| Request                            | Self-service                       | API                              |
| ---------------------------------- | ---------------------------------- | -------------------------------- |
| See consent history                | —                                  | `GET /privacy/consents`          |
| Withdraw consent / stop monitoring | **Disconnect Portal** in the popup | `DELETE /portal-connections/:id` |
| Download my data                   | **Export my data**                 | `POST /privacy/export`           |
| Delete my data, keep account       | **Delete my data**                 | `DELETE /privacy/data`           |
| Delete everything                  | **Delete my account**              | `DELETE /privacy/account`        |

## When a student asks support instead

1. Verify identity through the email address on the account (reply from that address). Never
   ask for the Portal password.
2. Prefer guiding them to the self-service buttons.
3. If they cannot sign in (forgotten password, before password recovery exists), an operator
   may delete the account: `DELETE FROM users WHERE email = lower('<address>');` — all
   user-owned rows cascade. Record the date and request in the support log (not the data).
4. Confirm completion to the student.

## What is kept

- After **Delete my data**: the account, sign-in sessions, registered devices, and consent
  records (policy version and dates only).
- After **Delete my account**: nothing. Database backups expire on the provider's backup
  retention schedule (document it for the pilot, for example 7 days).
- Logs contain no personal data by design (redacted at the source).

## Retention defaults

Change history 12 months (`RETENTION_HISTORY_DAYS`), operational records 90 days
(`RETENTION_OPERATIONAL_DAYS`), applied daily by the worker.
