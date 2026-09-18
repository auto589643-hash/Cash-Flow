# CA$HFLOW Meetup Registration System

Production registration, approval, email and check-in system with separate participant and admin routes.

## Live routes
- Participant: `https://cashflow-meetup-public.vercel.app/participant/`
- Admin: `https://cashflow-meetup-public.vercel.app/admin/`
- API: `https://cjqcyjuxsqtuybjqumlk.supabase.co/functions/v1/cashflow`

Vercel is the canonical production web host. `cashflow-web` remains a tracked Supabase Edge fallback/reference bundle, but Supabase Edge gateway response headers are not used as the primary browser surface.

## Production data authority
Supabase is the production authority for CA$HFLOW application data.

Application tables:
- `cashflow_rounds`
- `cashflow_registrations`
- `cashflow_settings`
- `cashflow_admin_credentials`
- `cashflow_admin_sessions`
- `cashflow_admin_login_attempts`
- `cashflow_email_outbox`
- `cashflow_audit_logs`

Runtime services:
- `cashflow` Edge Function — participant/admin API
- `cashflow-mailer` Edge Function — Gmail transactional mail worker
- Vercel — canonical participant/admin web host
- `cashflow-web` Edge Function — fallback/reference web bundle

Tracked production source on `main`:
- `supabase/functions/cashflow/`
- `supabase/functions/cashflow-mailer/`
- `supabase/functions/cashflow-web/`
- `supabase/migrations/20260918190500_cashflow_v5_production_parity.sql`

The old Google Sheet / Apps Script implementation is legacy only and must not be used as the production database.

## Registration rules
- One active registration per phone/email contact per round.
- Active states: `Pending`, `Approved`, `Waitlist`.
- `Rejected` and `Cancelled` may reapply; the new record links to the previous registration.
- Phone numbers are normalized and validated as Thai mobile numbers (10 digits, prefixes 06/08/09).
- Registration uses `client_request_id` for retry/idempotency.
- Explicit `?round=` URLs require an exact round match.
- When approval capacity is full, new registrations enter `Waitlist`.
- Registration, approval/capacity checks, cancellation and check-in use database-side atomic operations.

## Participant status
Participants can:
- Check status using the phone + email used to register.
- Request a secure manage link by email.
- Open the manage link to view/cancel an active registration before check-in.
- Reapply after `Rejected` or `Cancelled`.

Public status responses intentionally omit participant profile/contact PII.

## Admin operations
- Admin chooses a working round independently from the public default round.
- Admin can explicitly mark one round as the Public round.
- Capacity and remaining approval seats are visible and enforced server-side.
- Checked-in registrations are locked from normal status changes.
- Duplicate-contact history and email-delivery state are surfaced.
- Admin snapshots are labelled with sync freshness.

## Check-in
- QR payload contains only an opaque token.
- Native `BarcodeDetector` is used when available.
- Vendored `jsQR` provides the Safari/iPhone fallback.
- Scanner remains open between attendees and debounces repeated reads.
- Manual search by name/phone/reference remains available.
- Check-in is atomic and idempotent.

## Email integrity
Email is queued asynchronously in `cashflow_email_outbox`.

Supported events:
- Submission / Waitlist confirmation
- Approval + QR
- Status correction when a previously approved registration is later changed
- Requested secure manage link

The mail worker re-checks the current registration state immediately before sending and cancels stale messages instead of sending obsolete status.

## Security
- Admin password is never stored in frontend or GitHub.
- Salted password hash is stored in `cashflow_admin_credentials`.
- Admin sessions are server-side records in `cashflow_admin_sessions`; the browser holds only the opaque session token in `sessionStorage`.
- Admin login attempts are rate-limited.
- Canonical production pages call the Supabase `cashflow` Edge Function directly over CORS.
- The optional Vercel build can still use same-origin `/api/backend` as a proxy.
- Privileged database writes are only performed by the server-side Edge Function using service-role access.
- Security headers are configured in `vercel.json`.

## Deployment
Canonical production deployment:

- Vercel — participant/admin web UI
- `cashflow` Supabase Edge Function — API
- `cashflow-mailer` Supabase Edge Function — transactional email worker

The Vercel same-origin proxy defaults to:

`https://cjqcyjuxsqtuybjqumlk.supabase.co/functions/v1/cashflow`

Optional Vercel environment override:
- `CASHFLOW_API_URL`

Transactional-email manage links use:
`https://cashflow-meetup-public.vercel.app/participant/`

Do not configure the old `APPS_SCRIPT_URL` for production.

## Legacy
`apps-script/` is retained only as historical/reference material from the pre-Supabase implementation. See `apps-script/SETUP.md`.

## Third-party
`assets/jsQR.js` is vendored from `cozmo/jsQR` under Apache License 2.0. See `assets/jsQR.LICENSE.txt`.
