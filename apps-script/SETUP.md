# One-time Apps Script setup

1. Open the Google Sheet `Cash-Flow Registration Database`.
2. Extensions → Apps Script.
3. Replace the default `Code.gs` with `apps-script/Code.gs` from this repository.
4. Project Settings → enable `Show "appsscript.json" manifest file`, then paste the repository manifest if desired.
5. Run `setupCashflow()` once and grant permissions.
6. Reload the Google Sheet, then menu `Cashflow System` → `ตั้งรหัส Admin` and set a strong admin password.
7. Deploy → New deployment → Web app.
   - Execute as: Me
   - Who has access: Anyone
8. Copy the final `/exec` deployment URL and send it back to Emily. Emily can wire it into the web backend and redeploy. Alternatively, set it yourself as the Vercel Production environment variable `APPS_SCRIPT_URL` and redeploy.

The participant endpoint is public by design. Admin actions require a server-issued session token after password verification in Apps Script.
