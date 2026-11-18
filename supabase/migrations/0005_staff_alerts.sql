-- Retro Messenger v0.5.0 — secure, read-only staff alerts.
-- Run once after 0004_msn_features.sql using the Supabase SQL editor.
-- IMPORTANT: This migration creates NO staff accounts automatically.
-- Assign a role manually AFTER installation; see README.

create table if not exists public.messenger_staff (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('staff', 'admin')),
  assigned_at timestamptz not null default now()
);
alter table public.messenger_staff enable row level security;
revoke all on public.messenger_staff from anon, authenticated;
grant select on public.messenger_staff to authenticated;
drop policy if exists "read own messenger staff role" on public.messenger_staff;
create policy "read own messenger staff role" on public.messenger_staff
for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.staff_alert_batches (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete set null,
  title text not null check(char_length(btrim(title)) between 1 and 100),
  body text not null check(char_length(btrim(body)) between 1 and 2500),
  audience text not null check(audience in ('everyone', 'user')),
  target_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((audience='everyone' and target_user_id is null) or audience='user')
);
create index if not exists staff_alert_batches_author_recent on public.staff_alert_batches(author_id,created_at desc);
alter table public.staff_alert_batches enable row level security;
revoke all on public.staff_alert_batches from anon, authenticated;
grant select on public.staff_alert_batches to authenticated;

-- A recipient-specific row prevents anyone from reading someone else's alerts.
-- Updates are column-limited: clients may mark their own alerts read, but cannot
-- change the sender, recipient, title, body, or contents.
create table if not exists public.staff_alerts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.staff_alert_batches(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  title text not null check(char_length(btrim(title)) between 1 and 100),
  body text not null check(char_length(btrim(body)) between 1 and 2500),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique(batch_id,recipient_id)
);
create index if not exists staff_alerts_recipient_recent on public.staff_alerts(recipient_id,created_at desc);
alter table public.staff_alerts enable row level security;
revoke all on public.staff_alerts from anon, authenticated;
grant select, update(read_at) on public.staff_alerts to authenticated;
drop policy if exists "read own staff alerts" on public.staff_alerts;
create policy "read own staff alerts" on public.staff_alerts
for select to authenticated using (recipient_id=(select auth.uid()));
drop policy if exists "mark own staff alerts read" on public.staff_alerts;
create policy "mark own staff alerts read" on public.staff_alerts
for update to authenticated using (recipient_id=(select auth.uid()))
with check (recipient_id=(select auth.uid()));

create or replace function public.is_messenger_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.messenger_staff s where s.user_id=auth.uid());
$$;
revoke all on function public.is_messenger_staff() from public, anon;
grant execute on function public.is_messenger_staff() to authenticated;

drop policy if exists "staff read announcement audit" on public.staff_alert_batches;
create policy "staff read announcement audit" on public.staff_alert_batches
for select to authenticated using (public.is_messenger_staff());

-- A single RPC creates all recipient copies transactionally. Staff status is checked
-- on the server, not trusted from the React interface. Only existing, confirmed
-- Retro Messenger profiles receive a broadcast; it is not a future-user mailing list.
create or replace function public.send_staff_alert(
  p_title text,
  p_body text,
  p_audience text,
  p_username text default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_author uuid := auth.uid();
  v_target uuid;
  v_batch uuid;
  v_count integer;
begin
  if v_author is null or not exists (
    select 1 from public.messenger_staff s where s.user_id=v_author
  ) then raise exception 'Staff access required' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_title,''))) not between 1 and 100
    or char_length(btrim(coalesce(p_body,''))) not between 1 and 2500 then
    raise exception 'Title or message length is invalid';
  end if;
  if p_audience not in ('everyone','user') or p_audience is null then
    raise exception 'Audience must be everyone or user';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_author::text || ':staff-alerts',0));
  if (select count(*) from public.staff_alert_batches
      where author_id=v_author and created_at>now()-interval '15 minutes')>=10 then
    raise exception 'Sending limit reached. Try again later.';
  end if;

  if p_audience='user' then
    select id into v_target from public.profiles
    where username=lower(btrim(coalesce(p_username,''))) limit 1;
    if v_target is null then raise exception 'Username not found'; end if;
  end if;

  insert into public.staff_alert_batches(author_id,title,body,audience,target_user_id)
  values(v_author,btrim(p_title),btrim(p_body),p_audience,v_target)
  returning id into v_batch;

  insert into public.staff_alerts(batch_id,recipient_id,author_id,title,body)
  select v_batch,p.id,v_author,btrim(p_title),btrim(p_body)
  from public.profiles p
  where p_audience='everyone' or p.id=v_target;

  get diagnostics v_count = row_count;
  return v_count;
end;$$;
revoke all on function public.send_staff_alert(text,text,text,text) from public, anon;
grant execute on function public.send_staff_alert(text,text,text,text) to authenticated;

-- Needed for online INSERT notifications, subject to read-only RLS above.
do $$ begin
 if not exists (select 1 from pg_publication_tables
     where pubname='supabase_realtime' and schemaname='public' and tablename='staff_alerts') then
   alter publication supabase_realtime add table public.staff_alerts;
 end if;
end $$;

-- AFTER running this migration, assign staff manually in SQL Editor:
-- insert into public.messenger_staff(user_id,role)
-- select id,'admin' from public.profiles where username='YOUR_EXACT_USERNAME'
-- on conflict(user_id) do update set role=excluded.role;
-- NEVER put your Supabase service/secret key in frontend environment variables.
