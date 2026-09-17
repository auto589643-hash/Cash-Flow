# CA$HFLOW Meetup Registration System

Production-oriented registration/admin system with separate participant and admin routes.

## Routes
- `/participant/` — public event + registration
- `/admin/` — password-protected admin dashboard, rounds and check-in
- `/api/backend` — same-origin Vercel proxy to Google Apps Script

## Database
Google Sheet: `Cash-Flow Registration Database`
Tabs: `Registrations`, `Rounds`, `Settings`, `AuditLog`.

## Backend
Google Apps Script is the data authority. It validates writes, applies capacity rules, issues admin sessions, records audit logs, sends approval email, and writes to Sheets.

## Security
- Admin password is never stored in frontend or GitHub.
- Password hash lives in Apps Script Script Properties.
- Admin session token lives in Apps Script CacheService and browser sessionStorage.
- Browser talks to same-origin `/api/backend`; Vercel proxies to Apps Script.
- Duplicate registrations are allowed, but duplicate contact data is flagged.
- Registration submission uses `client_request_id` for retry/idempotency.

## Current setup dependency
The Apps Script Web App must be deployed once and its `/exec` URL added to Vercel as `APPS_SCRIPT_URL`. See `apps-script/SETUP.md`.

## Notes
Approval QR images are rendered by QuickChart using only an opaque QR token (no name/email/phone). Add-to-Calendar is included only when both an exact event date and end time are configured.
