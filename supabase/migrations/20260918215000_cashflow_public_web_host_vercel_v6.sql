-- Keep transactional participant/manage links on the canonical Vercel web host.
insert into public.cashflow_settings(key,value,description)
values (
  'public_app_url',
  to_jsonb('https://cashflow-meetup-public.vercel.app/participant/'::text),
  'Canonical public participant URL used in transactional emails'
)
on conflict (key) do update
set value=excluded.value,
    description=excluded.description,
    updated_at=now();
