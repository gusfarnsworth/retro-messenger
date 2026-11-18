-- Retro Messenger 0.6.2: automatic personalised no-reply System DMs.
-- Requires 0006_system_direct_messages.sql.
-- Run as a Supabase database administrator.
-- First run also sends ONE welcome to every existing profile.
-- Safe to re-run: the partial unique index prevents duplicate welcomes.

begin;

-- Keep automated welcomes distinct from messages written by admins.
alter table public.system_direct_messages
  add column if not exists message_kind text not null default 'admin';

-- Use a named dollar quote; the closing tag MUST be present.
do $welcome_constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.system_direct_messages'::regclass
      and conname = 'system_direct_messages_kind_check'
  ) then
    alter table public.system_direct_messages
      add constraint system_direct_messages_kind_check
      check (message_kind in ('admin', 'welcome'));
  end if;
end;
$welcome_constraint$;

-- Exactly one automatic welcome can be stored for each recipient.
create unique index if not exists system_direct_one_welcome_per_user
  on public.system_direct_messages (recipient_id)
  where message_kind = 'welcome';

create or replace function public.send_new_user_welcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $send_welcome$
declare
  v_display_name text;
begin
  v_display_name := coalesce(nullif(btrim(new.display_name), ''), new.username, 'friend');

  insert into public.system_direct_messages
    (recipient_id, admin_sender_id, subject, body, message_kind)
  values (
    new.id,
    null,
    format('Welcome to Retro Messenger, %s!', v_display_name),
    format(
      E'Hey %s!\n\nWelcome to Retro Messenger, @%s. We''re glad you''re here!\n\n'
      || 'To get started, choose a display picture, add a friend by searching for their username, '
      || E'and set your status or personal message. When your friends are online, open a chat and say hello.\n\n'
      || E'Don''t forget to try the classic emoticons and Nudges!\n\n'
      || 'This is an automatic welcome from Retro Messenger System. Replies are switched off, '
      || E'but you can always find this message in Official Messenger.\n\nEnjoy your time here!',
      v_display_name, new.username
    ),
    'welcome'
  )
  on conflict do nothing;

  return new;
exception when others then
  -- Never prevent an otherwise valid registration due to a welcome failure.
  raise warning 'Retro Messenger welcome could not be queued for %: %', new.id, sqlerrm;
  return new;
end;
$send_welcome$;

-- Clients must not be able to call the trigger function as an RPC.
revoke all on function public.send_new_user_welcome()
  from public, anon, authenticated;

drop trigger if exists retro_send_welcome_after_profile on public.profiles;
create trigger retro_send_welcome_after_profile
  after insert on public.profiles
  for each row execute function public.send_new_user_welcome();

-- One-time backfill for everyone who had already created an account.
-- On later executions this statement inserts ZERO rows for users who
-- already received an automatic welcome (or were welcomed by the trigger).
insert into public.system_direct_messages
  (recipient_id, admin_sender_id, subject, body, message_kind)
select
  p.id,
  null,
  format('Welcome to Retro Messenger, %s!',
    coalesce(nullif(btrim(p.display_name), ''), p.username, 'friend')),
  format(
    E'Hey %s!\n\nWelcome to Retro Messenger, @%s. We''re glad you''re here!\n\n'
    || 'To get started, choose a display picture, add a friend by searching for their username, '
    || E'and set your status or personal message. When your friends are online, open a chat and say hello.\n\n'
    || E'Don''t forget to try the classic emoticons and Nudges!\n\n'
    || 'This is an automatic welcome from Retro Messenger System. Replies are switched off, '
    || E'but you can always find this message in Official Messenger.\n\nEnjoy your time here!',
    coalesce(nullif(btrim(p.display_name), ''), p.username, 'friend'),
    p.username
  ),
  'welcome'
from public.profiles p
where not exists (
  select 1 from public.system_direct_messages m
  where m.recipient_id = p.id and m.message_kind = 'welcome'
)
on conflict do nothing;

commit;

-- Confirmation: how many profiles currently have a system welcome?
select
  (select count(*) from public.profiles) as total_accounts,
  (select count(*) from public.system_direct_messages where message_kind = 'welcome') as accounts_with_welcome,
  (select count(*) from public.profiles p where not exists (
    select 1 from public.system_direct_messages m
    where m.recipient_id = p.id and m.message_kind = 'welcome'
  )) as accounts_missing_welcome;
