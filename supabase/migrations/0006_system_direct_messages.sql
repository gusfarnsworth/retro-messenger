-- Retro Messenger v0.6 — official one-to-one, NO REPLY system messages.
-- Requires 0005_staff_alerts.sql. Run ONCE in Supabase SQL Editor.
-- Unlike announcements, these appear as a conversation from a fixed System sender.
-- No direct INSERT, DELETE or message-reply permission is granted to clients.

create table if not exists public.system_direct_messages (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  admin_sender_id uuid references public.profiles(id) on delete set null,
  subject text not null default 'Official Message'
    check (char_length(btrim(subject)) between 1 and 100),
  body text not null check (char_length(btrim(body)) between 1 and 2500),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists system_direct_recipient_recent
  on public.system_direct_messages(recipient_id,created_at desc,id);
create index if not exists system_direct_admin_recent
  on public.system_direct_messages(admin_sender_id,created_at desc,id);
alter table public.system_direct_messages enable row level security;
revoke all on public.system_direct_messages from public, anon, authenticated;
grant select, update(read_at) on public.system_direct_messages to authenticated;

-- Recipients see their own messages. The sending admin may inspect their own
-- sending history. Other users, including ordinary staff, may not read them.
drop policy if exists "system direct read recipient or author" on public.system_direct_messages;
create policy "system direct read recipient or author"
  on public.system_direct_messages for select to authenticated
  using (
    recipient_id = (select auth.uid())
    or (
      admin_sender_id = (select auth.uid())
      and exists (
        select 1 from public.messenger_staff s
        where s.user_id = (select auth.uid()) and s.role = 'admin'
      )
    )
  );

-- The only client UPDATE allowed is read_at; sender/recipient/content cannot change.
drop policy if exists "system direct recipient mark read" on public.system_direct_messages;
create policy "system direct recipient mark read"
  on public.system_direct_messages for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- Secure server-only insertion. p_username must be an EXACT username.
create or replace function public.send_system_direct_message(
  p_username text,
  p_subject text,
  p_body text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_author uuid := auth.uid();
  v_recipient uuid;
  v_message uuid;
begin
  if v_author is null or not exists (
    select 1 from public.messenger_staff s
    where s.user_id = v_author and s.role = 'admin'
  ) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if char_length(btrim(coalesce(p_username,''))) not between 3 and 20
     or char_length(btrim(coalesce(p_subject,''))) not between 1 and 100
     or char_length(btrim(coalesce(p_body,''))) not between 1 and 2500 then
    raise exception 'Invalid recipient, subject or message length';
  end if;

  select p.id into v_recipient from public.profiles p
    where p.username = lower(btrim(p_username)) limit 1;
  if v_recipient is null then
    raise exception 'Recipient username not found';
  end if;

  -- Serialize sends per admin so a burst cannot bypass the limit.
  perform pg_advisory_xact_lock(hashtextextended(v_author::text || ':system-direct',0));
  if (select count(*) from public.system_direct_messages m
      where m.admin_sender_id = v_author
        and m.created_at > now() - interval '15 minutes') >= 20 then
    raise exception 'Sending limit reached (20 per 15 minutes)';
  end if;

  insert into public.system_direct_messages(recipient_id,admin_sender_id,subject,body)
  values(v_recipient,v_author,btrim(p_subject),btrim(p_body))
  returning id into v_message;

  return v_message;
end;$$;
revoke all on function public.send_system_direct_message(text,text,text)
  from public, anon;
grant execute on function public.send_system_direct_message(text,text,text)
  to authenticated;

-- Needed for realtime delivery (RLS still controls which records users can see).
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'system_direct_messages'
  ) then
    alter publication supabase_realtime add table public.system_direct_messages;
  end if;
end $$;
