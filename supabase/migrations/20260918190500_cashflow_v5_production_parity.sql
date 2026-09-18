-- CA$HFLOW v5 production parity migration
-- Mirrors the database contract used by Supabase Edge Functions in production.

alter table public.cashflow_registrations
  add column if not exists manage_token uuid default gen_random_uuid(),
  add column if not exists cancelled_at timestamptz,
  add column if not exists reapply_of_registration_id uuid references public.cashflow_registrations(id);

update public.cashflow_registrations
set manage_token = gen_random_uuid()
where manage_token is null;

alter table public.cashflow_registrations
  alter column manage_token set default gen_random_uuid(),
  alter column manage_token set not null;

create unique index if not exists cashflow_registrations_manage_token_uidx
  on public.cashflow_registrations(manage_token);

create index if not exists cashflow_registrations_round_contact_active_idx
  on public.cashflow_registrations(round_id, phone, lower(email), status);

alter table public.cashflow_email_outbox
  drop constraint if exists cashflow_email_outbox_email_type_check;

alter table public.cashflow_email_outbox
  add constraint cashflow_email_outbox_email_type_check
  check (email_type = any (array['submission','approval','status_correction','manage_link']::text[]));

insert into public.cashflow_settings(key,value,description)
values
  ('active_round_code', to_jsonb('cashflow-01'::text), 'Public default round code for CA$HFLOW participant page'),
  ('public_app_url', to_jsonb('https://cjqcyjuxsqtuybjqumlk.supabase.co/functions/v1/cashflow-web/participant/'::text), 'Canonical public participant URL used in transactional emails')
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.cashflow_apply_registration_status_v2(p_registration_id uuid, p_status text, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reg public.cashflow_registrations%rowtype;
  v_round public.cashflow_rounds%rowtype;
  v_updated public.cashflow_registrations%rowtype;
  v_approved integer;
  v_email_queued boolean := false;
begin
  if p_status not in ('Pending','Approved','Waitlist','Rejected','Cancelled') then
    raise exception 'invalid_status';
  end if;

  select * into v_reg
  from public.cashflow_registrations
  where id = p_registration_id
  for update;
  if not found then raise exception 'registration_not_found'; end if;

  select * into v_round
  from public.cashflow_rounds
  where id = v_reg.round_id
  for update;
  if not found then raise exception 'round_not_found'; end if;

  if v_reg.checked_in_at is not null and p_status <> v_reg.status then
    raise exception 'checked_in_locked';
  end if;

  if p_status in ('Pending','Approved','Waitlist') and p_status <> v_reg.status then
    if exists (
      select 1 from public.cashflow_registrations x
      where x.round_id=v_reg.round_id
        and x.id<>v_reg.id
        and x.status in ('Pending','Approved','Waitlist')
        and (x.phone=v_reg.phone or lower(x.email)=lower(v_reg.email))
    ) then
      raise exception 'contact_conflict';
    end if;
  end if;

  if p_status='Approved' and v_reg.status<>'Approved' and v_round.capacity_enabled then
    select count(*)::int into v_approved
    from public.cashflow_registrations
    where round_id=v_round.id and status='Approved' and id<>v_reg.id;
    if coalesce(v_round.approval_capacity,0)>0 and v_approved >= v_round.approval_capacity then
      raise exception 'capacity_full';
    end if;
  end if;

  if p_status = v_reg.status then
    return jsonb_build_object('registration',to_jsonb(v_reg),'email_queued',false);
  end if;

  if v_reg.status='Approved' and p_status<>'Approved' then
    update public.cashflow_email_outbox
    set status='cancelled',updated_at=now(),last_error='status_changed_before_send'
    where registration_id=v_reg.id
      and email_type='approval'
      and status in ('pending','processing');

    if v_reg.approval_email_sent_at is not null then
      insert into public.cashflow_email_outbox(email_type,registration_id,to_email,status,provider)
      values('status_correction',v_reg.id,v_reg.email,'pending','gmail');
      v_email_queued := true;
    end if;
  end if;

  update public.cashflow_registrations
  set
    status = p_status,
    approved_at = case
      when p_status='Approved' then coalesce(approved_at,now())
      else approved_at end,
    cancelled_at = case when p_status='Cancelled' then now() else null end,
    admin_note = case when coalesce(p_note,'')<>'' then p_note else admin_note end,
    approval_email_status = case
      when p_status='Approved' then 'queued'
      when p_status<>'Approved' and approval_email_sent_at is null then 'skipped'
      else approval_email_status end,
    updated_at = now()
  where id=v_reg.id
  returning * into v_updated;

  if p_status='Approved' then
    if not exists (
      select 1 from public.cashflow_email_outbox
      where registration_id=v_reg.id and email_type='approval' and status in ('pending','processing','sent')
    ) then
      insert into public.cashflow_email_outbox(email_type,registration_id,to_email,status,provider)
      values('approval',v_reg.id,v_reg.email,'pending','gmail');
      v_email_queued := true;
    end if;
  end if;

  insert into public.cashflow_audit_logs(actor,action,round_id,registration_id,detail)
  values('admin','status_change',v_reg.round_id,v_reg.id,
    jsonb_build_object('from',v_reg.status,'to',p_status,'backend','supabase_v5'));

  return jsonb_build_object('registration',to_jsonb(v_updated),'email_queued',v_email_queued);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cashflow_cancel_registration_v2(p_manage_token uuid, p_round_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reg public.cashflow_registrations%rowtype;
  v_round_code text;
  v_updated public.cashflow_registrations%rowtype;
  v_email_queued boolean := false;
begin
  select r.* into v_reg
  from public.cashflow_registrations r
  where r.manage_token=p_manage_token
  for update;

  if not found then raise exception 'invalid_manage_token'; end if;

  select round_code into v_round_code
  from public.cashflow_rounds
  where id=v_reg.round_id;

  if p_round_code is not null and p_round_code<>'' and v_round_code<>p_round_code then
    raise exception 'registration_not_found';
  end if;
  if v_reg.checked_in_at is not null then raise exception 'checked_in_locked'; end if;

  if v_reg.status not in ('Pending','Approved','Waitlist') then
    return jsonb_build_object('registration',to_jsonb(v_reg),'email_queued',false);
  end if;

  update public.cashflow_email_outbox
  set status='cancelled',updated_at=now(),last_error='participant_cancelled_before_send'
  where registration_id=v_reg.id
    and email_type='approval'
    and status in ('pending','processing');

  if v_reg.status='Approved' and v_reg.approval_email_sent_at is not null then
    insert into public.cashflow_email_outbox(email_type,registration_id,to_email,status,provider)
    values('status_correction',v_reg.id,v_reg.email,'pending','gmail');
    v_email_queued := true;
  end if;

  update public.cashflow_registrations
  set status='Cancelled',cancelled_at=now(),updated_at=now(),
      approval_email_status=case when approval_email_sent_at is null then 'skipped' else approval_email_status end
  where id=v_reg.id
  returning * into v_updated;

  insert into public.cashflow_audit_logs(actor,action,round_id,registration_id,detail)
  values('participant','cancel',v_reg.round_id,v_reg.id,jsonb_build_object('backend','supabase_v5'));

  return jsonb_build_object('registration',to_jsonb(v_updated),'email_queued',v_email_queued);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cashflow_check_in_v2(p_registration_id uuid DEFAULT NULL::uuid, p_qr_token uuid DEFAULT NULL::uuid, p_round_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reg public.cashflow_registrations%rowtype;
  v_round_code text;
  v_updated public.cashflow_registrations%rowtype;
begin
  if p_registration_id is null and p_qr_token is null then
    raise exception 'registration_not_found';
  end if;

  if p_registration_id is not null then
    select * into v_reg from public.cashflow_registrations
    where id=p_registration_id for update;
  else
    select * into v_reg from public.cashflow_registrations
    where qr_token=p_qr_token for update;
  end if;

  if not found then raise exception 'registration_not_found'; end if;

  select round_code into v_round_code from public.cashflow_rounds where id=v_reg.round_id;
  if p_round_code is not null and p_round_code<>'' and v_round_code<>p_round_code then
    raise exception 'registration_not_found';
  end if;
  if v_reg.status<>'Approved' then raise exception 'not_approved'; end if;

  if v_reg.checked_in_at is not null then
    return jsonb_build_object('registration',to_jsonb(v_reg),'already_checked_in',true);
  end if;

  update public.cashflow_registrations
  set checked_in_at=now(),updated_at=now()
  where id=v_reg.id
  returning * into v_updated;

  insert into public.cashflow_audit_logs(actor,action,round_id,registration_id,detail)
  values('admin','check_in',v_reg.round_id,v_reg.id,jsonb_build_object('backend','supabase_v5'));

  return jsonb_build_object('registration',to_jsonb(v_updated),'already_checked_in',false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cashflow_register_v2(p_round_code text, p_client_request_id text, p_full_name text, p_nickname text, p_age_range text, p_phone text, p_email text, p_money_style text DEFAULT ''::text, p_money_goal text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_round public.cashflow_rounds%rowtype;
  v_existing public.cashflow_registrations%rowtype;
  v_active public.cashflow_registrations%rowtype;
  v_inserted public.cashflow_registrations%rowtype;
  v_reapply_id uuid;
  v_ref text;
  v_status text;
  v_approved integer;
  v_full boolean;
begin
  select * into v_round
  from public.cashflow_rounds
  where round_code = p_round_code
  for update;

  if not found then raise exception 'round_not_found'; end if;
  if v_round.status <> 'Open' then raise exception 'round_closed'; end if;

  if coalesce(p_client_request_id,'') <> '' then
    select * into v_existing
    from public.cashflow_registrations
    where client_request_id = p_client_request_id
    limit 1;
    if found then
      return jsonb_build_object(
        'registration', to_jsonb(v_existing),
        'idempotent', true,
        'already_registered', false,
        'duplicate_warning', false,
        'email_queued', v_existing.submission_email_status in ('queued','sent')
      );
    end if;
  end if;

  select * into v_active
  from public.cashflow_registrations
  where round_id = v_round.id
    and status in ('Pending','Approved','Waitlist')
    and (phone = p_phone or lower(email) = lower(p_email))
  order by submitted_at desc
  limit 1;

  if found then
    if v_active.phone = p_phone and lower(v_active.email) = lower(p_email) then
      return jsonb_build_object(
        'registration', to_jsonb(v_active),
        'idempotent', false,
        'already_registered', true,
        'duplicate_warning', true,
        'email_queued', false
      );
    end if;
    raise exception 'contact_conflict';
  end if;

  select id into v_reapply_id
  from public.cashflow_registrations
  where round_id = v_round.id
    and status in ('Rejected','Cancelled')
    and phone = p_phone
    and lower(email) = lower(p_email)
  order by submitted_at desc
  limit 1;

  select count(*)::int into v_approved
  from public.cashflow_registrations
  where round_id = v_round.id and status = 'Approved';

  v_full := v_round.capacity_enabled
            and coalesce(v_round.approval_capacity,0) > 0
            and v_approved >= v_round.approval_capacity;
  v_status := case when v_full then 'Waitlist' else 'Pending' end;

  for i in 1..30 loop
    v_ref := lpad((floor(random()*900000)+100000)::int::text,6,'0');
    exit when not exists (
      select 1 from public.cashflow_registrations where reference_code = v_ref
    );
  end loop;

  insert into public.cashflow_registrations(
    round_id,submitted_at,full_name,nickname,age_range,phone,email,
    money_style,money_goal,status,reference_code,client_request_id,
    submission_email_status,approval_email_status,reapply_of_registration_id,
    metadata
  )
  values(
    v_round.id,now(),p_full_name,p_nickname,p_age_range,p_phone,lower(p_email),
    nullif(p_money_style,''),nullif(p_money_goal,''),v_status,v_ref,p_client_request_id,
    'queued','pending',v_reapply_id,
    jsonb_build_object('source','supabase_rpc_v5')
  )
  returning * into v_inserted;

  insert into public.cashflow_email_outbox(email_type,registration_id,to_email,status,provider)
  values('submission',v_inserted.id,v_inserted.email,'pending','gmail');

  insert into public.cashflow_audit_logs(actor,action,round_id,registration_id,detail)
  values(
    'participant',
    case when v_status='Waitlist' then 'register_waitlist' else 'register' end,
    v_round.id,
    v_inserted.id,
    jsonb_build_object('backend','supabase_v5','reapplication',v_reapply_id is not null)
  );

  return jsonb_build_object(
    'registration', to_jsonb(v_inserted),
    'idempotent', false,
    'already_registered', false,
    'duplicate_warning', false,
    'reapplication', v_reapply_id is not null,
    'waitlist', v_status='Waitlist',
    'email_queued', true
  );
end;
$function$;

revoke all on function public.cashflow_register_v2(text,text,text,text,text,text,text,text,text) from public;
revoke all on function public.cashflow_apply_registration_status_v2(uuid,text,text) from public;
revoke all on function public.cashflow_cancel_registration_v2(uuid,text) from public;
revoke all on function public.cashflow_check_in_v2(uuid,uuid,text) from public;

grant execute on function public.cashflow_register_v2(text,text,text,text,text,text,text,text,text) to service_role;
grant execute on function public.cashflow_apply_registration_status_v2(uuid,text,text) to service_role;
grant execute on function public.cashflow_cancel_registration_v2(uuid,text) to service_role;
grant execute on function public.cashflow_check_in_v2(uuid,uuid,text) to service_role;
