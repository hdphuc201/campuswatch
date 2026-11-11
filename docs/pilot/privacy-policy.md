# CampusWatch privacy policy (pilot draft)

> **Draft for the pilot.** To be reviewed by the pilot organizers and, where required, the
> university's data-protection contact before students are invited. Items in [brackets] must
> be completed.

**Operator:** [name and contact of the person or team running the pilot]
**Effective:** [date] · **Consent version:** 2026-11

## What CampusWatch does

CampusWatch is a Chrome extension and a server that notify you when your academic data on the
CITD Portal changes. The extension reads Portal pages in your own browser, using the Portal
session you opened yourself, and sends extracted data to the CampusWatch server.

## What we collect

| Data                                                                                                                             | Why                                                       | Kept                                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| Email and a hashed password (CampusWatch account)                                                                                | Sign-in                                                   | Until you delete the account                                  |
| Grades, GPA and credits, tuition amounts and status, timetable, exam schedule, Dashboard notices (as extracted text and numbers) | Detect and notify changes                                 | Current state while connected; change history up to 12 months |
| Device record (browser name, extension version, last seen)                                                                       | Secure the connection between your browser and the server | Until revoked, then 90 days                                   |
| Notification settings and delivery status                                                                                        | Deliver notifications as you chose                        | Settings until deleted; delivery records 90 days              |
| Telegram link (encrypted chat identifier), if you link Telegram                                                                  | Send Telegram messages                                    | Until you unlink                                              |
| Consent records (policy version and dates)                                                                                       | Show what you agreed to and when                          | Until you delete the account                                  |

## What we never collect

- Your CITD Portal password, cookies, or session tokens.
- Copies of Portal web pages (HTML).
- Anything when Chrome or your computer is off.
- Data from other websites.

CampusWatch never logs in to the Portal for you and never changes anything in the Portal.

## How data is protected

Encrypted connections (HTTPS); passwords hashed with Argon2id; device and session tokens stored
only as hashes; Telegram chat identifiers encrypted; strict separation between users, tested
automatically; logs redacted so they contain no personal or academic data; rate limits against
abuse. Access to the server is limited to the operators named above, who do not view students'
academic data except to help a student who asks.

## Sharing

We do not sell or share your data. Service providers that host the server or send Telegram
messages process data only to provide the service. [List hosting provider and region.]
Telegram messages are delivered by Telegram; by default they contain only a summary such as
"1 grade update", not scores or amounts.

## Your choices and rights

- **Pause** or **Disconnect Portal** at any time (disconnecting withdraws consent).
- **Export** all your data, **delete your data**, or **delete your account** in the extension
  (Settings and data → Your data). Deletion takes effect immediately; backups expire within
  [N] days.
- Choose which changes notify you, quiet hours, and message detail.
- Contact: [support address].

## Changes to this policy

We will ask for consent again if we change what we collect or why. The consent version shown in
the extension identifies the policy you agreed to.
