# Cash-Flow Apps Script setup / upgrade

## First-time setup
1. Open the Google Sheet `Cash-Flow Registration Database`.
2. Extensions → Apps Script.
3. Replace `Code.gs` with `apps-script/Code.gs` from this repository.
4. Run `setupCashflow()` once and grant permissions.
5. Reload the Google Sheet, then menu `Cashflow System` → `ตั้งรหัส Admin` and set a strong admin password.
6. Deploy → New deployment → Web app.
   - Execute as: Me
   - Who has access: Anyone
7. Use the final `/exec` URL as Vercel `APPS_SCRIPT_URL`.

## Upgrade
1. Replace the existing Apps Script `Code.gs` with the latest file.
2. Run `setupCashflow()` again.
   - Existing data is preserved.
   - Missing registration columns are appended automatically, including manage/cancel/reapply fields.
   - `EmailQueue` is created if missing.
   - A 1-minute `processEmailQueue` trigger is installed if missing.
3. Deploy → Manage deployments → Edit existing Web app deployment → New version → Deploy.
   - Keep Execute as: Me.
   - Keep Who has access: Anyone.
   - The `/exec` URL should remain the same.

## Settings
The Admin UI can set `active_round_code` by choosing “ตั้งเป็น Public”.

Optional Settings rows:
- `public_app_url` — defaults to `https://cashflow-meetup-public.vercel.app/participant/`
- `email_sender_name` — defaults to `CA$HFLOW Meetup`
- `admin_session_minutes` — defaults to 360 and is clamped between 5 and 360 minutes

## Registration behavior
- Explicit round codes are exact-match only.
- Active duplicate contact data is blocked.
- Rejected/Cancelled registrations can reapply as a new record.
- Thai mobile validation is server-authoritative.
- Full capacity creates `Waitlist` registrations automatically.
- Participant cancellation requires the opaque manage token sent by email.

## Email behavior
Automatic email events:
- Submission/Waitlist email after a successful registration.
- Approval email when Admin moves a registration to `Approved`.
- Status-correction email when the current registration state changes and an updated participant notification is required.
- On-demand manage-link email after participant phone + email verification.

Email sending is asynchronous through `EmailQueue`.

The worker re-validates current registration state immediately before sending. Stale submission/approval/status-correction messages are cancelled rather than sent with obsolete state.

## Check-in integrity
- Only `Approved` registrations may check in.
- Repeated check-in is idempotent and returns an “already checked in” result.
- Once checked in, ordinary Admin status changes are blocked.
- QR and manage tokens are separate credentials.

## Performance
- Participant round data uses short Apps Script cache + browser cache.
- Admin uses one `adminBootstrap` request where available.
- Admin renders a recent session snapshot immediately, labels it as cached/stale, then refreshes every 15 seconds while visible.
- Registration/status writes use `LockService` where concurrent writes can create inconsistent state.
