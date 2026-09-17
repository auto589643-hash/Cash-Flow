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
7. Use the final `/exec` URL as the website backend.

## Upgrade from v1 to v2
1. Replace the existing Apps Script `Code.gs` with the latest `apps-script/Code.gs`.
2. Run `setupCashflow()` once again.
   - Existing registration data is preserved.
   - Missing headers are appended automatically.
   - A new `EmailQueue` sheet is created.
   - A 1-minute `processEmailQueue` trigger is installed if it does not already exist.
3. Deploy → Manage deployments → Edit the existing Web app deployment → New version → Deploy.
   - Keep Execute as: Me.
   - Keep Who has access: Anyone.
   - The `/exec` URL should remain the same.

## Email behavior
Only two automatic email events exist:
- Submission email: queued immediately after a participant submits the application.
- Approval email: queued only when Admin changes a registration to `Approved`.

Waitlist, Reject, Check-in and ordinary Admin refresh actions do not send email.

Email sending is processed asynchronously from `EmailQueue`, so participant saves and Admin approvals do not wait for Gmail delivery. The queue normally processes within about one minute.

## Performance changes
- Participant event data uses short server cache + browser stale-while-revalidate cache.
- Admin uses one `adminBootstrap` request instead of separate dashboard + rounds requests when the v2 backend is deployed.
- Admin renders a recent session snapshot immediately and refreshes in the background every 15 seconds while visible.
- Registration and approval logic read the registration table once per write path instead of repeatedly scanning it.

The participant endpoint is public by design. Admin actions still require a server-issued session token after password verification in Apps Script.