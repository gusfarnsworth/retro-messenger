-- Retro Messenger v0.9.0, one-time combined migration.
-- Run AFTER 0001 through 0009. Do NOT also run 0010/0011 individually.
-- Both parts apply atomically, or neither applies if there is an error.

begin;

-- Part 1: 0010_system_polls.sql
-- Retro Messenger 0.9 — broadcast polls in official NO REPLY System conversations.
-- Apply AFTER 0009_moderation_actions.sql in Supabase SQL Editor.
-- Poll creation/closing is admin-only; one vote per recipient; votes can be
-- changed until the poll is closed. Neither votes nor poll tables allow direct writes.


create table if not exists public.system_polls (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete restrict,
  question text not null check (char_length(btrim(question)) between 10 and 180),
  description text not null default '' check (char_length(description) <= 750),
  created_at timestamptz not null default now(),
  closes_at timestamptz,
  closed_at timestamptz,
  check (closes_at is null or closes_at > created_at)
);
create table if not exists public.system_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.system_polls(id) on delete cascade,
  position smallint not null check (position between 1 and 6),
  label text not null check (char_length(btrim(label)) between 1 and 100),
  unique (poll_id, position),
  unique (poll_id, id)
);
create table if not exists public.system_poll_votes (
  poll_id uuid not null references public.system_polls(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  option_id uuid not null,
  voted_at timestamptz not null default now(),
  primary key (poll_id, voter_id),
  foreign key (poll_id, option_id) references public.system_poll_options(poll_id,id) on delete cascade
);
create index if not exists system_poll_votes_choice_idx on public.system_poll_votes(poll_id,option_id);

alter table public.system_direct_messages add column if not exists poll_id uuid references public.system_polls(id) on delete set null;
create index if not exists system_direct_poll_reference_idx on public.system_direct_messages(poll_id) where poll_id is not null;
-- The previous migration permits only admin/welcome. Keep both and add poll.
alter table public.system_direct_messages drop constraint if exists system_direct_messages_kind_check;
alter table public.system_direct_messages add constraint system_direct_messages_kind_check
  check (message_kind in ('admin','welcome','poll'));

alter table public.system_polls enable row level security;
alter table public.system_poll_options enable row level security;
alter table public.system_poll_votes enable row level security;
revoke all on public.system_polls,public.system_poll_options,public.system_poll_votes from public,anon,authenticated;
-- Poll content and aggregate counts are exposed only by checked RPC functions.

create or replace function public.create_system_poll(
  p_question text, p_description text, p_options text[], p_closes_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $fn$
declare
  v_sender uuid := auth.uid();
  v_poll_id uuid;
  v_option text;
  v_position integer := 0;
  v_count integer;
begin
  if v_sender is null or not exists (
    select 1 from public.messenger_staff where user_id=v_sender and role='admin'
  ) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_question,''))) not between 10 and 180
    or char_length(coalesce(p_description,'')) > 750
    or coalesce(array_length(p_options,1),0) not between 2 and 6
    or (p_closes_at is not null and p_closes_at <= now() + interval '5 minutes')
  then raise exception 'Question (10–180 chars), description (max 750), 2–6 options and valid closing time required'; end if;
  if exists(select 1 from unnest(p_options) x where x is null or char_length(btrim(x)) not between 1 and 100) then
    raise exception 'Each option must contain 1–100 characters';
  end if;
  if (select count(distinct lower(btrim(x))) from unnest(p_options) x) <> array_length(p_options,1) then
    raise exception 'Poll choices must be different';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_sender::text || ':broadcast-polls',0));
  if exists(select 1 from public.system_polls where creator_id=v_sender and created_at>now()-interval '5 minutes') then
    raise exception 'Wait 5 minutes before sending another poll';
  end if;
  insert into public.system_polls(creator_id,question,description,closes_at)
    values (v_sender,btrim(p_question),btrim(coalesce(p_description,'')),p_closes_at)
    returning id into v_poll_id;
  foreach v_option in array p_options loop
    v_position := v_position+1;
    insert into public.system_poll_options(poll_id,position,label) values(v_poll_id,v_position,btrim(v_option));
  end loop;
  -- One official message per existing account, including the creator.
  insert into public.system_direct_messages(recipient_id,admin_sender_id,message_kind,poll_id,subject,body)
    select p.id,v_sender,'poll',v_poll_id,'Community Poll',
           left(btrim(p_question),2500) from public.profiles p;
  get diagnostics v_count = row_count;
  if v_count=0 then raise exception 'No recipients were found'; end if;
  return v_poll_id;
end;
$fn$;
revoke all on function public.create_system_poll(text,text,text[],timestamptz) from public,anon;
grant execute on function public.create_system_poll(text,text,text[],timestamptz) to authenticated;

create or replace function public.vote_system_poll(p_poll_id uuid,p_option_id uuid)
returns void language plpgsql security definer set search_path='' as $fn$
declare v_user uuid := auth.uid(); v_poll public.system_polls%rowtype;
begin
  if v_user is null or not public.moderation_can_send(v_user) then
    raise exception 'Voting is unavailable while messaging is restricted' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text||':'||coalesce(p_poll_id::text,''),0));
  select * into v_poll from public.system_polls where id=p_poll_id for update;
  if not found then raise exception 'Poll not found'; end if;
  if v_poll.closed_at is not null or (v_poll.closes_at is not null and v_poll.closes_at<=now()) then
    raise exception 'This poll has closed';
  end if;
  if not exists (select 1 from public.system_direct_messages
                 where recipient_id=v_user and poll_id=p_poll_id) then
    raise exception 'You are not an eligible recipient' using errcode='42501';
  end if;
  if not exists (select 1 from public.system_poll_options
                 where id=p_option_id and poll_id=p_poll_id) then
    raise exception 'Invalid poll choice';
  end if;
  insert into public.system_poll_votes(poll_id,voter_id,option_id) values(p_poll_id,v_user,p_option_id)
    on conflict (poll_id,voter_id) do update set option_id=excluded.option_id,voted_at=now();
end;
$fn$;
revoke all on function public.vote_system_poll(uuid,uuid) from public,anon;
grant execute on function public.vote_system_poll(uuid,uuid) to authenticated;

-- Poll views and totals: eligible recipients can read them; administrators
-- can inspect any poll. Voter identities are never exposed to other users.
create or replace function public.get_system_poll_results(p_poll_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare v_user uuid := auth.uid(); v_is_admin boolean;
begin
  if v_user is null then raise exception 'Sign in first' using errcode='42501'; end if;
  if coalesce(cardinality(p_poll_ids),0)>60 then raise exception 'Too many polls requested'; end if;
  select exists(select 1 from public.messenger_staff where user_id=v_user and role='admin') into v_is_admin;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'question',p.question,'description',p.description,
    'created_at',p.created_at,'closes_at',p.closes_at,'closed_at',p.closed_at,
    'is_closed',(p.closed_at is not null or (p.closes_at is not null and p.closes_at<=now())),
    'total_votes',(select count(*) from public.system_poll_votes v where v.poll_id=p.id),
    'my_option_id',(select v.option_id from public.system_poll_votes v where v.poll_id=p.id and v.voter_id=v_user),
    'options',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',o.id,'label',o.label,'position',o.position,
      'votes',(select count(*) from public.system_poll_votes v where v.option_id=o.id)
    ) order by o.position),'[]'::jsonb) from public.system_poll_options o where o.poll_id=p.id)
  ) order by p.created_at desc) from public.system_polls p
  where p.id=any(coalesce(p_poll_ids,array[]::uuid[])) and (
    v_is_admin or exists(select 1 from public.system_direct_messages m
      where m.poll_id=p.id and m.recipient_id=v_user)
  )),'[]'::jsonb);
end;
$fn$;
revoke all on function public.get_system_poll_results(uuid[]) from public,anon;
grant execute on function public.get_system_poll_results(uuid[]) to authenticated;

create or replace function public.list_admin_system_poll_ids()
returns uuid[] language plpgsql stable security definer set search_path='' as $fn$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists(select 1 from public.messenger_staff where user_id=v_user and role='admin') then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  return coalesce((select array_agg(id order by created_at desc) from
    (select id,created_at from public.system_polls order by created_at desc limit 40) q),array[]::uuid[]);
end;
$fn$;
revoke all on function public.list_admin_system_poll_ids() from public,anon;
grant execute on function public.list_admin_system_poll_ids() to authenticated;

create or replace function public.close_system_poll(p_poll_id uuid)
returns void language plpgsql security definer set search_path='' as $fn$
begin
  if auth.uid() is null or not exists(select 1 from public.messenger_staff where user_id=auth.uid() and role='admin') then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  update public.system_polls set closed_at=now() where id=p_poll_id and closed_at is null;
  if not found then raise exception 'Poll not found or already closed'; end if;
end;
$fn$;
revoke all on function public.close_system_poll(uuid) from public,anon;
grant execute on function public.close_system_poll(uuid) to authenticated;


-- Part 2: 0011_groups_and_replies.sql
-- Retro Messenger 0.9 — reply-to message links and private group chats.
-- Run AFTER migration 0010_system_polls.sql.
-- Group membership changes occur ONLY through guarded SECURITY DEFINER RPCs.


alter table public.messages add column if not exists reply_to_id uuid references public.messages(id) on delete set null;
create index if not exists messages_reply_to_idx on public.messages(reply_to_id) where reply_to_id is not null;

create or replace function public.validate_message_reply() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare v_parent_conversation uuid;
begin
  if new.reply_to_id is null then return new; end if;
  select conversation_id into v_parent_conversation from public.messages where id=new.reply_to_id;
  if v_parent_conversation is null or v_parent_conversation<>new.conversation_id then
    raise exception 'Replies must reference a message in the same conversation';
  end if;
  return new;
end;
$fn$;
revoke all on function public.validate_message_reply() from public,anon,authenticated;
drop trigger if exists validate_message_reply_insert on public.messages;
create trigger validate_message_reply_insert before insert or update of reply_to_id,conversation_id
  on public.messages for each row execute function public.validate_message_reply();

-- The initial type constraint allowed 'dm' only.
alter table public.conversations drop constraint if exists conversations_type_check;
alter table public.conversations add constraint conversations_type_check check(type in ('dm','group'));
alter table public.conversations add column if not exists group_title text;
alter table public.conversations add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.conversations add constraint group_title_valid
  check(type='dm' or (char_length(btrim(coalesce(group_title,''))) between 2 and 60));
create index if not exists conversations_group_created on public.conversations(created_at desc) where type='group';
create index if not exists conversation_members_user_idx on public.conversation_members(user_id,conversation_id);

-- Existing RLS policies on messages/files/typing/chat_events call can_message().
-- Retain DM mutual-contact rules but permit authorised group members to talk.
create or replace function public.can_message(c uuid,u uuid)
returns boolean language sql stable security definer set search_path='' as $fn$
  select public.moderation_can_send(u)
    and public.is_member(c,u)
    and exists (
      select 1 from public.conversations conv where conv.id=c and (
        (conv.type='group' and exists (
          select 1 from public.conversation_members cm where cm.conversation_id=c and cm.user_id<>u
        )) or
        (conv.type='dm' and exists (
          select 1 from public.conversation_members m where m.conversation_id=c
          and m.user_id<>u and public.is_contact(u,m.user_id) and public.is_contact(m.user_id,u)
        ))
      )
    );
$fn$;

create or replace function public.create_group_chat(p_title text,p_members uuid[])
returns uuid language plpgsql security definer set search_path='' as $fn$
declare
  v_creator uuid:=auth.uid(); v_member uuid; v_group uuid; v_ids uuid[];
begin
  if v_creator is null or not public.moderation_can_send(v_creator) then
    raise exception 'Messaging is restricted' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_title,''))) not between 2 and 60 then
    raise exception 'Group name must contain 2–60 characters'; end if;
  v_ids:=array(select distinct x from unnest(coalesce(p_members,array[]::uuid[])) x where x is not null and x<>v_creator);
  if cardinality(v_ids) not between 2 and 11 then
    raise exception 'Select 2–11 contacts (groups allow 3–12 members including you)'; end if;
  foreach v_member in array v_ids loop
    if not public.is_contact(v_creator,v_member) or not public.is_contact(v_member,v_creator) then
      raise exception 'Group members must be accepted contacts' using errcode='42501'; end if;
    if public.moderation_is_suspended(v_member) then raise exception 'Cannot add a suspended account'; end if;
  end loop;
  insert into public.conversations(type,group_title,owner_id)
    values('group',btrim(p_title),v_creator) returning id into v_group;
  insert into public.conversation_members(conversation_id,user_id) values(v_group,v_creator);
  insert into public.conversation_members(conversation_id,user_id)
    select v_group,unnest(v_ids);
  return v_group;
end;
$fn$;
revoke all on function public.create_group_chat(text,uuid[]) from public,anon;
grant execute on function public.create_group_chat(text,uuid[]) to authenticated;

-- A group owner can add accepted contacts; no one can silently add strangers.
create or replace function public.add_group_member(p_group_id uuid,p_new_user uuid)
returns void language plpgsql security definer set search_path='' as $fn$
declare v_creator uuid:=auth.uid(); v_owner uuid; v_count integer;
begin
  if v_creator is null or not public.moderation_can_send(v_creator) then
    raise exception 'Messaging is restricted' using errcode='42501'; end if;
  select owner_id into v_owner from public.conversations where id=p_group_id and type='group' for update;
  if not found or v_owner is distinct from v_creator then
    raise exception 'Only the group owner may add members' using errcode='42501'; end if;
  if p_new_user is null or not public.is_contact(v_creator,p_new_user)
     or not public.is_contact(p_new_user,v_creator)
     or public.moderation_is_suspended(p_new_user) then
    raise exception 'Select an accepted contact'; end if;
  select count(*) into v_count from public.conversation_members where conversation_id=p_group_id;
  if v_count>=12 then raise exception 'Group member limit reached (12)'; end if;
  insert into public.conversation_members(conversation_id,user_id) values(p_group_id,p_new_user)
    on conflict do nothing;
end;
$fn$;
revoke all on function public.add_group_member(uuid,uuid) from public,anon;
grant execute on function public.add_group_member(uuid,uuid) to authenticated;

create or replace function public.leave_group_chat(p_group_id uuid)
returns void language plpgsql security definer set search_path='' as $fn$
declare v_user uuid:=auth.uid(); v_owner uuid; v_next uuid;
begin
  if v_user is null then raise exception 'Sign in first' using errcode='42501'; end if;
  select owner_id into v_owner from public.conversations where id=p_group_id and type='group' for update;
  if not found or not public.is_member(p_group_id,v_user) then
    raise exception 'You are not a member of this group' using errcode='42501'; end if;
  delete from public.conversation_members where conversation_id=p_group_id and user_id=v_user;
  if not exists(select 1 from public.conversation_members where conversation_id=p_group_id) then
    delete from public.conversations where id=p_group_id;
  elsif v_owner=v_user or v_owner is null then
    select user_id into v_next from public.conversation_members
      where conversation_id=p_group_id order by user_id limit 1;
    update public.conversations set owner_id=v_next where id=p_group_id;
  end if;
end;
$fn$;
revoke all on function public.leave_group_chat(uuid) from public,anon;
grant execute on function public.leave_group_chat(uuid) to authenticated;


commit;
