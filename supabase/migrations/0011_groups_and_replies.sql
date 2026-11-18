-- Retro Messenger 0.9 — reply-to message links and private group chats.
-- Run AFTER migration 0010_system_polls.sql.
-- Group membership changes occur ONLY through guarded SECURITY DEFINER RPCs.

begin;

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
