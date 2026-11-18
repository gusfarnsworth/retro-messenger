-- Retro Messenger MVP. Apply using Supabase SQL editor on a NEW project.
-- Run as a database administrator, not with a client publishable key.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
 display_name text not null check (char_length(display_name) between 1 and 40),
 personal_message text not null default '' check (char_length(personal_message)<=100),
 avatar_url text,
 status_preference text not null default 'online' check (status_preference in ('online','away','busy','invisible')),
 last_seen_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.contact_requests (
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null references public.profiles(id) on delete cascade,
 receiver_id uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check (status in ('pending','accepted','rejected')),
 created_at timestamptz not null default now(),
 check (sender_id<>receiver_id)
);
create unique index if not exists contact_requests_pending_unique on public.contact_requests(sender_id,receiver_id) where status='pending';
create table if not exists public.contacts (
 user_id uuid not null references public.profiles(id) on delete cascade,
 contact_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(user_id,contact_id),check(user_id<>contact_id)
);
create table if not exists public.user_blocks (
 blocker_id uuid not null references public.profiles(id) on delete cascade,
 blocked_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(blocker_id,blocked_id),check(blocker_id<>blocked_id)
);
create table if not exists public.conversations (
 id uuid primary key default gen_random_uuid(),
 type text not null default 'dm' check (type='dm'),
 created_at timestamptz not null default now()
);
create table if not exists public.conversation_members (
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 primary key(conversation_id,user_id)
);
create table if not exists public.messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 sender_id uuid not null references public.profiles(id) on delete cascade,
 body text not null check (char_length(btrim(body)) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index if not exists messages_conversation_time on public.messages(conversation_id,created_at desc);
create index if not exists contacts_reverse on public.contacts(contact_id);

-- Create profile from verified Auth signup metadata. Failure will reject signup;
-- usernames must be unique and cannot be silently overwritten.
create or replace function public.new_user_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare handle text; shown text;
begin
 handle:=lower(coalesce(new.raw_user_meta_data->>'username',''));
 shown:=left(btrim(coalesce(new.raw_user_meta_data->>'display_name',handle)),40);
 if handle !~ '^[a-z0-9_]{3,20}$' or shown='' then raise exception 'Invalid username or display name';end if;
 insert into public.profiles(id,username,display_name) values(new.id,handle,shown);
 return new;
end;$$;
drop trigger if exists auth_user_profile on auth.users;
create trigger auth_user_profile after insert on auth.users for each row execute function public.new_user_profile();

-- Restrict data mutations and make relationship operations transactional.
create or replace function public.is_contact(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.contacts where user_id=a and contact_id=b)
 and not exists(select 1 from public.user_blocks where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a));
$$;
create or replace function public.is_member(c uuid,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conversation_members where conversation_id=c and user_id=u);
$$;
create or replace function public.can_message(c uuid,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_member(c,u) and exists(
 select 1 from public.conversation_members m where m.conversation_id=c and m.user_id<>u
 and public.is_contact(u,m.user_id) and public.is_contact(m.user_id,u));
$$;
create or replace function public.respond_contact_request(request_id uuid,accept_request boolean) returns void language plpgsql security definer set search_path='' as $$
declare target public.contact_requests%rowtype;
begin
 select * into target from public.contact_requests where id=request_id and receiver_id=auth.uid() and status='pending' for update;
 if not found then raise exception 'Request not found'; end if;
 if accept_request then
   if exists(select 1 from public.user_blocks where (blocker_id=target.sender_id and blocked_id=target.receiver_id) or (blocker_id=target.receiver_id and blocked_id=target.sender_id)) then raise exception 'Blocked';end if;
   insert into public.contacts(user_id,contact_id) values(target.sender_id,target.receiver_id),(target.receiver_id,target.sender_id) on conflict do nothing;
 end if;
 update public.contact_requests set status=case when accept_request then 'accepted' else 'rejected' end where id=request_id;
end;$$;
-- Race-resistant canonical one-to-one DM lookup; locks by ordered pair.
create or replace function public.get_or_create_dm(other_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare mine uuid:=auth.uid(); found_id uuid; pair_key text;
begin
 if mine is null or other_user=mine or not public.is_contact(mine,other_user) or not public.is_contact(other_user,mine) then raise exception 'Only accepted contacts can message'; end if;
 pair_key:=least(mine::text,other_user::text)||':'||greatest(mine::text,other_user::text);
 perform pg_advisory_xact_lock(hashtextextended(pair_key,0));
 select c.id into found_id from public.conversations c
 join public.conversation_members a on a.conversation_id=c.id and a.user_id=mine
 join public.conversation_members b on b.conversation_id=c.id and b.user_id=other_user
 where c.type='dm' and (select count(*) from public.conversation_members cm where cm.conversation_id=c.id)=2 limit 1;
 if found_id is null then
   insert into public.conversations(type) values('dm') returning id into found_id;
   insert into public.conversation_members(conversation_id,user_id) values(found_id,mine),(found_id,other_user);
 end if;
 return found_id;
end;$$;
revoke all on function public.respond_contact_request(uuid,boolean) from public;
revoke all on function public.get_or_create_dm(uuid) from public;
grant execute on function public.respond_contact_request(uuid,boolean) to authenticated;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.contact_requests enable row level security;
alter table public.contacts enable row level security;
alter table public.user_blocks enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
create policy "authenticated can discover usernames" on public.profiles for select to authenticated using (true);
create policy "edit own profile" on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy "read involved requests" on public.contact_requests for select to authenticated using(sender_id=(select auth.uid()) or receiver_id=(select auth.uid()));
create policy "create contact request" on public.contact_requests for insert to authenticated with check(sender_id=(select auth.uid()) and status='pending' and not public.is_contact(sender_id,receiver_id) and not exists(select 1 from public.user_blocks where (blocker_id=sender_id and blocked_id=receiver_id) or (blocker_id=receiver_id and blocked_id=sender_id)));
create policy "read own contacts" on public.contacts for select to authenticated using(user_id=(select auth.uid()));
-- Remove both directions via function to keep relationships symmetric.
create or replace function public.remove_contact(other_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Not authenticated';end if;
 delete from public.contacts where (user_id=auth.uid() and contact_id=other_user) or (user_id=other_user and contact_id=auth.uid());
end;$$;
revoke all on function public.remove_contact(uuid) from public;
grant execute on function public.remove_contact(uuid) to authenticated;
create policy "read own blocks" on public.user_blocks for select to authenticated using(blocker_id=(select auth.uid()));
create policy "block users" on public.user_blocks for insert to authenticated with check(blocker_id=(select auth.uid()));
create policy "unblock users" on public.user_blocks for delete to authenticated using(blocker_id=(select auth.uid()));
create policy "read conversations" on public.conversations for select to authenticated using(public.is_member(id,(select auth.uid())));
create policy "read memberships" on public.conversation_members for select to authenticated using(public.is_member(conversation_id,(select auth.uid())));
create policy "read messages" on public.messages for select to authenticated using(public.is_member(conversation_id,(select auth.uid())));
create policy "send messages" on public.messages for insert to authenticated with check(sender_id=(select auth.uid()) and public.can_message(conversation_id,(select auth.uid())));

-- Enable Postgres Changes for early MVP messaging. For larger scale, migrate
-- to authorised Realtime Broadcast triggers.
do $$begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then alter publication supabase_realtime add table public.messages;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='contacts') then alter publication supabase_realtime add table public.contacts;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='contact_requests') then alter publication supabase_realtime add table public.contact_requests;end if;
end$$;

-- Presence channel access: accepted contacts may subscribe; only owner may track.
create policy "presence subscriptions to contacts" on realtime.messages for select to authenticated using(
 realtime.messages.extension='presence' and realtime.topic() like 'presence-%' and (
 substring(realtime.topic() from 10)::uuid=auth.uid() or
 public.is_contact(auth.uid(),substring(realtime.topic() from 10)::uuid)
 ));
create policy "presence owner can track" on realtime.messages for insert to authenticated with check(
 realtime.messages.extension='presence' and realtime.topic() = 'presence-'||auth.uid()::text
 );
