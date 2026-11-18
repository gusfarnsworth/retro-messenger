-- Retro Messenger v0.8.0 — case-linked enforcement, reversals and audit.
-- Requires 0001 through 0008. Run in Supabase SQL Editor with project owner access.
-- A suspension restricts Retro Messenger database usage; it does NOT change
-- Supabase Auth's server-side ban flag or invalidate an existing Auth token.
-- All sanctions are initiated by a staff-reviewed REPORT, never automatically.

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.user_reports(id) on delete restrict,
  target_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action_type text not null check (action_type in ('warning','mute','suspension')),
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  internal_note text not null default '' check (char_length(internal_note)<=1000),
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoke_reason text,
  check (target_id <> actor_id),
  check (action_type = 'warning' or expires_at is null or expires_at > issued_at),
  check (action_type <> 'warning' or expires_at is null),
  check ((revoked_at is null and revoked_by is null and revoke_reason is null)
      or (revoked_at is not null and revoked_by is not null and char_length(btrim(coalesce(revoke_reason,''))) between 10 and 500))
);
create index if not exists moderation_target_active_idx
  on public.moderation_actions(target_id,action_type,issued_at desc)
  where revoked_at is null;
create index if not exists moderation_report_recent_idx
  on public.moderation_actions(report_id,issued_at desc);

create table if not exists public.moderation_action_events (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.moderation_actions(id) on delete restrict,
  event_type text not null check (event_type in ('issued','revoked')),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  event_reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists moderation_events_action_idx on public.moderation_action_events(action_id,created_at desc);

alter table public.moderation_actions enable row level security;
alter table public.moderation_action_events enable row level security;
revoke all on public.moderation_actions,public.moderation_action_events from public,anon,authenticated;
grant select on public.moderation_actions,public.moderation_action_events to authenticated;

drop policy if exists "staff inspect moderation actions" on public.moderation_actions;
create policy "staff inspect moderation actions" on public.moderation_actions
  for select to authenticated using (public.is_messenger_staff());
drop policy if exists "staff inspect moderation events" on public.moderation_action_events;
create policy "staff inspect moderation events" on public.moderation_action_events
  for select to authenticated using (public.is_messenger_staff());

-- SECURITY DEFINER reads a private action table; the caller only receives
-- whether messaging/session usage is currently restricted (never staff notes).
create or replace function public.moderation_is_suspended(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.moderation_actions a
    where a.target_id=p_user_id and a.action_type='suspension'
      and a.revoked_at is null and (a.expires_at is null or a.expires_at>now())
  );
$$;
create or replace function public.moderation_can_send(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and not exists (
    select 1 from public.moderation_actions a
    where a.target_id=p_user_id and a.action_type in ('mute','suspension')
      and a.revoked_at is null and (a.expires_at is null or a.expires_at>now())
  );
$$;
revoke all on function public.moderation_is_suspended(uuid) from public,anon;
revoke all on function public.moderation_can_send(uuid) from public,anon;
grant execute on function public.moderation_is_suspended(uuid) to authenticated;
grant execute on function public.moderation_can_send(uuid) to authenticated;

-- Replace the function used by message, nudge, wink, file-upload and typing
-- policies. All existing RLS policies refer to can_message(), so this applies
-- immediately to BOTH website and desktop clients without trusting the UI.
create or replace function public.can_message(c uuid,u uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.moderation_can_send(u)
    and public.is_member(c,u)
    and exists (
      select 1 from public.conversation_members m
      where m.conversation_id=c and m.user_id<>u
        and public.is_contact(u,m.user_id) and public.is_contact(m.user_id,u)
    );
$$;

-- Restrict sending new contact requests from muted or suspended accounts.
drop policy if exists "create contact request" on public.contact_requests;
create policy "create contact request" on public.contact_requests for insert to authenticated
with check (
  sender_id=(select auth.uid()) and public.moderation_can_send((select auth.uid()))
  and status='pending' and not public.is_contact(sender_id,receiver_id)
  and not exists (
    select 1 from public.user_blocks
    where (blocker_id=sender_id and blocked_id=receiver_id)
       or (blocker_id=receiver_id and blocked_id=sender_id)
  )
);

-- Suspended accounts cannot read ordinary Messenger data through REST.
-- Official System DMs remain accessible to view the sanction notice.
-- These are restrictive policies: they must pass in addition to existing RLS.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'messages','chat_events','contacts','contact_requests',
    'conversations','conversation_members','contact_options','user_blocks'
  ] loop
    execute format('drop policy if exists "suspended accounts cannot read" on public.%I', v_table);
    execute format('create policy "suspended accounts cannot read" on public.%I as restrictive for select to authenticated using (not public.moderation_is_suspended((select auth.uid())))',v_table);
  end loop;
end;
$$;
-- The account can still see its own identity, and the suspension screen uses
-- a purpose-built RPC below; other profiles are not visible during a suspension.
drop policy if exists "suspended profiles self only" on public.profiles;
create policy "suspended profiles self only" on public.profiles
  as restrictive for select to authenticated using (
    not public.moderation_is_suspended((select auth.uid())) or id=(select auth.uid())
  );
-- Prevent suspended account profile editing and avatar uploads.
drop policy if exists "suspended accounts cannot edit profiles" on public.profiles;
create policy "suspended accounts cannot edit profiles" on public.profiles
  as restrictive for update to authenticated using (
    not public.moderation_is_suspended((select auth.uid()))
  ) with check (not public.moderation_is_suspended((select auth.uid())));
drop policy if exists "suspended accounts cannot edit avatars" on storage.objects;
create policy "suspended accounts cannot edit avatars" on storage.objects
  as restrictive for insert to authenticated with check (
    bucket_id <> 'avatars' or not public.moderation_is_suspended((select auth.uid()))
  );
drop policy if exists "suspended accounts cannot delete avatars" on storage.objects;
create policy "suspended accounts cannot delete avatars" on storage.objects
  as restrictive for delete to authenticated using (
    bucket_id <> 'avatars' or not public.moderation_is_suspended((select auth.uid()))
  );

-- Preserve proper Auth session behaviour: a suspended user can read ONLY their
-- own restriction summary, without getting staff-only moderation records.
create or replace function public.get_my_moderation_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_uid uuid := auth.uid();
  v_susp public.moderation_actions%rowtype;
  v_mute public.moderation_actions%rowtype;
begin
  if v_uid is null then raise exception 'Sign in first' using errcode='42501'; end if;
  select * into v_susp from public.moderation_actions
    where target_id=v_uid and action_type='suspension'
      and revoked_at is null and (expires_at is null or expires_at>now())
    order by issued_at desc limit 1;
  select * into v_mute from public.moderation_actions
    where target_id=v_uid and action_type='mute'
      and revoked_at is null and (expires_at is null or expires_at>now())
    order by issued_at desc limit 1;
  return jsonb_build_object(
    'is_suspended',v_susp.id is not null,
    'is_muted',v_mute.id is not null,
    'suspended_until',v_susp.expires_at,
    'muted_until',v_mute.expires_at,
    'suspension_reason',v_susp.reason,
    'mute_reason',v_mute.reason
  );
end;
$$;
revoke all on function public.get_my_moderation_status() from public,anon;
grant execute on function public.get_my_moderation_status() to authenticated;

-- Staff warnings/mutes; only admins can suspend accounts. A staff account
-- can never be sanctioned via this panel, including by another admin.
create or replace function public.apply_report_moderation(
  p_report_id uuid,
  p_action_type text,
  p_duration text,
  p_reason text,
  p_internal_note text default ''
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_report public.user_reports%rowtype;
  v_action uuid;
  v_until timestamptz;
  v_reason text := btrim(coalesce(p_reason,''));
  v_note text := btrim(coalesce(p_internal_note,''));
  v_duration_label text;
  v_subject text;
  v_body text;
begin
  select role into v_role from public.messenger_staff where user_id=v_actor;
  if v_actor is null or coalesce(v_role not in ('staff','admin'), true) then
    raise exception 'Staff permission required' using errcode='42501';
  end if;
  if p_action_type is null or p_action_type not in ('warning','mute','suspension') then
    raise exception 'Invalid moderation action';
  end if;
  if p_action_type='suspension' and v_role<>'admin' then
    raise exception 'Only administrators can suspend accounts' using errcode='42501';
  end if;
  if char_length(v_reason) not between 10 and 500 or char_length(v_note)>1000 then
    raise exception 'Provide a 10–500 character reason and up to 1,000 characters of internal notes';
  end if;
  if p_action_type='warning' then
    if p_duration is distinct from 'none' then raise exception 'Warnings have no duration'; end if;
    v_until:=null;
    v_duration_label:='No restriction';
  elsif p_action_type='mute' then
    if p_duration is null or p_duration not in ('1h','24h','7d','30d') then raise exception 'Invalid mute duration'; end if;
    if v_role='staff' and p_duration='30d' then raise exception 'Admins only for 30-day mutes'; end if;
    v_until:=now()+case p_duration when '1h' then interval '1 hour'
      when '24h' then interval '24 hours' when '7d' then interval '7 days'
      else interval '30 days' end;
    v_duration_label:=p_duration;
  else
    if p_duration is null or p_duration not in ('24h','7d','30d','permanent') then raise exception 'Invalid suspension duration'; end if;
    v_until:=case p_duration when '24h' then now()+interval '24 hours'
      when '7d' then now()+interval '7 days'
      when '30d' then now()+interval '30 days'
      else null end;
    v_duration_label:=case when p_duration='permanent' then 'Until reversed by an administrator' else p_duration end;
  end if;

  select * into v_report from public.user_reports where id=p_report_id for update;
  if not found then raise exception 'Case not found'; end if;
  if v_report.target_id=v_actor or exists (
    select 1 from public.messenger_staff where user_id=v_report.target_id
  ) then raise exception 'You cannot moderate yourself or another staff account' using errcode='42501'; end if;
  if v_report.status='dismissed' then raise exception 'Reopen a dismissed case before taking action'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_report.target_id::text||':moderation',0));
  if p_action_type in ('mute','suspension') and exists (
    select 1 from public.moderation_actions
    where target_id=v_report.target_id and action_type=p_action_type
      and revoked_at is null and (expires_at is null or expires_at>now())
  ) then raise exception 'An active restriction of this type already exists. Revoke it first.'; end if;

  insert into public.moderation_actions(
    report_id,target_id,actor_id,action_type,reason,internal_note,expires_at
  ) values (p_report_id,v_report.target_id,v_actor,p_action_type,v_reason,v_note,v_until)
  returning id into v_action;
  insert into public.moderation_action_events(action_id,event_type,actor_id,event_reason)
    values (v_action,'issued',v_actor,v_reason);

  update public.user_reports set status='resolved', reviewed_by=v_actor,
    updated_at=now(),staff_note=left(concat_ws(E'\n',nullif(staff_note,''),v_note),2000)
  where id=p_report_id;
  insert into public.user_report_actions(report_id,actor_id,previous_status,next_status,note)
    values(p_report_id,v_actor,v_report.status,'resolved',left('Moderation: '||p_action_type||' ('||v_duration_label||'). '||v_note,2000));

  v_subject:=case p_action_type when 'warning' then 'Account warning'
    when 'mute' then 'Messaging restricted' else 'Account suspended' end;
  v_body:=case p_action_type when 'warning' then
      'Your Retro Messenger account has received an official warning.'
    when 'mute' then 'You cannot send messages, nudges, winks, or files while this restriction is active.'
    else 'Your Retro Messenger account is suspended while this restriction is active.' end
    ||E'\n\nReason: '||v_reason||E'\nDuration: '||v_duration_label
    ||case when v_until is not null then E'\nEnds: '||to_char(v_until at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC' else '' end
    ||E'\n\nCase: '||left(p_report_id::text,8)||E'\nThis is an official no-reply message.';
  insert into public.system_direct_messages(recipient_id,admin_sender_id,subject,body)
    values (v_report.target_id,null,v_subject,v_body);
  return v_action;
end;
$$;
revoke all on function public.apply_report_moderation(uuid,text,text,text,text) from public,anon;
grant execute on function public.apply_report_moderation(uuid,text,text,text,text) to authenticated;

-- Revocations retain an immutable audit event and notify the account. Admins
-- may reverse any restriction; staff may reverse warnings/mutes only.
create or replace function public.revoke_moderation_action(
  p_action_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_action public.moderation_actions%rowtype;
  v_reason text := btrim(coalesce(p_reason,''));
begin
  select role into v_role from public.messenger_staff where user_id=v_actor;
  if v_actor is null or coalesce(v_role not in ('staff','admin'), true) then
    raise exception 'Staff access required' using errcode='42501';
  end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'Supply a revocation reason between 10 and 500 characters';
  end if;
  select * into v_action from public.moderation_actions where id=p_action_id for update;
  if not found then raise exception 'Moderation action not found'; end if;
  if v_action.action_type='suspension' and v_role<>'admin' then
    raise exception 'Administrator permission required to revoke a suspension' using errcode='42501';
  end if;
  if v_action.revoked_at is not null then raise exception 'This action was already revoked'; end if;
  update public.moderation_actions set revoked_at=now(),revoked_by=v_actor,revoke_reason=v_reason
    where id=p_action_id;
  insert into public.moderation_action_events(action_id,event_type,actor_id,event_reason)
    values(p_action_id,'revoked',v_actor,v_reason);
  insert into public.system_direct_messages(recipient_id,admin_sender_id,subject,body)
    values(v_action.target_id,null,'Moderation action reversed',
      'A moderation action ('||v_action.action_type||') on your Retro Messenger account has been revoked.'
      ||E'\n\nReason: '||v_reason||E'\nCase: '||left(v_action.report_id::text,8)
      ||E'\nNo reply is required.');
end;
$$;
revoke all on function public.revoke_moderation_action(uuid,text) from public,anon;
grant execute on function public.revoke_moderation_action(uuid,text) to authenticated;
