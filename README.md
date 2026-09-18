# CA$HFLOW Meetup Registration System

Production-oriented registration/admin system with separate participant and admin routes.

## Routes
- `/participant/` — public event, registration, status lookup and secure manage-link flow
- `/admin/` — password-protected applicants, rounds and check-in operations
- `/api/backend` — same-origin Vercel proxy to Google Apps Script

## Data authority
Google Apps Script + Google Sheets remain server-authoritative.

Sheets:
- `Registrations`
- `Rounds`
- `Settings`
- `AuditLog`
- `EmailQueue`

## Registration rules
- One active registration per person/contact per round.
- Active states: `Pending`, `Approved`, `Waitlist`.
- `Rejected` and `Cancelled` may submit a new registration; the new record links back to the previous record.
- Phone numbers are normalized and validated as Thai mobile numbers (10 digits, prefixes 06/08/09).
- Registration uses `client_request_id` for retry/idempotency.
- Explicit `?round=` URLs require an exact round match. They never silently fall back to another round.
- When approval capacity is full, a new registration is created as `Waitlist`.

## Participant status
Participants can:
- Check status using the same phone + email used to register.
- Open a secure manage link from registration/approval email.
- Cancel an active registration from the secure manage link before check-in.
- Reapply after `Rejected` or `Cancelled`.

## Admin operations
- Admin chooses a working round independently from the public default round.
- Admin can explicitly mark one round as the Public round.
- Checked-in registrations are locked from ordinary status changes.
- Capacity and remaining approval seats are visible.
- Duplicate-contact history and email-delivery state are surfaced.
- Admin snapshot cache is labelled with sync freshness.

## Check-in
- QR payload contains only an opaque token.
- Native `BarcodeDetector` is used when available.
- Vendored `jsQR` is used as a cross-browser fallback, including Safari/iPhone.
- Scanner stays open between attendees and debounces repeat reads.
- Manual search by name/phone/reference remains available.

## Email integrity
Email is queued asynchronously.

Before an approval email is sent, the worker re-checks that the registration is still `Approved`. Pending approval emails are cancelled when status changes away from Approved.

Manage links use a separate opaque `manage_token`; the check-in QR token is not reused for participant account/status management.

## Security
- Admin password is never stored in frontend or GitHub.
- Password hash lives in Apps Script Script Properties.
- Admin session token lives in Apps Script CacheService and browser `sessionStorage`.
- Browser talks to same-origin `/api/backend`; Vercel proxies to Apps Script.
- Security headers are configured in `vercel.json`.
- Participant status responses do not expose full profile/contact data.

## Setup dependency
Deploy the Apps Script Web App and set its `/exec` URL as Vercel `APPS_SCRIPT_URL`.

Run `setupCashflow()` after upgrading the backend so new columns and EmailQueue requirements are present. See `apps-script/SETUP.md`.

## Third-party
`assets/jsQR.js` is vendored from `cozmo/jsQR` under Apache License 2.0. See `assets/jsQR.LICENSE.txt`.
