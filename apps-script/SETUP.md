# LEGACY — Google Apps Script backend

> **DO NOT USE FOR PRODUCTION.** CA$HFLOW production data and API have moved to Supabase.

This folder is retained only as historical/reference material for the previous Google Sheets + Apps Script implementation.

## Current production authority

Use:
- Supabase tables prefixed `cashflow_`
- Supabase Edge Function `cashflow`
- Supabase Edge Function `cashflow-mailer`
- Vercel same-origin proxy at `/api/backend`

The Google Sheet previously used by this backend has been retired and renamed as a legacy database. Do not run `setupCashflow()`, create a new Apps Script deployment, or point Vercel back to `APPS_SCRIPT_URL` unless explicitly performing a rollback.

## Historical note

The files in this directory document the pre-Supabase architecture only. Production deployment instructions are in the repository root `README.md`.
