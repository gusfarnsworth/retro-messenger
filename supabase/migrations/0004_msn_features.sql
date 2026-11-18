-- Retro Messenger 0.4.0: run once AFTER 0001, 0002 and 0003.
-- Adds contact preferences, file transfers, message formatting and Winks.

-- Historical statuses share the four canonical colour categories in the UI.
alter table public.profiles drop constraint if exists profiles_status_preference_check;
alter table public.profiles add constraint profiles_status_preference_check
check (status_preference in ('online','away','busy','invisible','brb','phone','lunch'));

-- Older messages (including v0.3 JSON bodies) remain readable.
alter table public.messages add column if not exists format jsonb not null default '{}'::jsonb;
alter table public.messages add column if not exists kind text not null default 'text';
alter table public.messages add column if not exists attachment_path text;
alter table public.messages add constraint messages_kind_valid check(kind in ('text','file'));

alter table public.chat_events drop constraint if exists chat_events_kind_check;
alter table public.chat_events add constraint chat_events_kind_check check(kind in ('nudge','wink'));
alter table public.chat_events add column if not exists payload jsonb not null default '{}'::jsonb;

create or replace function public.enforce_nudge_cooldown() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.conversation_id::text || new.sender_id::text,0));
 if exists(select 1 from public.chat_events
           where conversation_id=new.conversation_id and sender_id=new.sender_id and kind=new.kind
           and created_at>now()-case when new.kind='nudge' then interval '15 seconds' else interval '5 seconds' end) then
   raise exception 'Please wait before sending another %', new.kind;
 end if;
 return new;
end;$$;

-- Individual contact nicknames and groups, synchronised across devices.
create table if not exists public.contact_options (
 user_id uuid not null references public.profiles(id) on delete cascade,
 contact_id uuid not null references public.profiles(id) on delete cascade,
 group_name text not null default 'Friends' check(group_name in ('Friends','Family','Work','Other')),
 nickname text not null default '' check(char_length(nickname)<=40),
 primary key(user_id,contact_id),check(user_id<>contact_id)
);
alter table public.contact_options enable row level security;
create policy "read own contact options" on public.contact_options for select to authenticated using (user_id=(select auth.uid()));
create policy "insert own contact options" on public.contact_options for insert to authenticated
 with check(user_id=(select auth.uid()) and public.is_contact(user_id,contact_id));
create policy "update own contact options" on public.contact_options for update to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and public.is_contact(user_id,contact_id));
create policy "remove own contact options" on public.contact_options for delete to authenticated using(user_id=(select auth.uid()));

-- Private Storage: accepted conversation members can exchange small, non-executable files.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('transfers','transfers',false,10485760,array['image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain','application/zip','application/x-zip-compressed'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;

-- Files are stored under <conversation_uuid>/<random_uuid>-<sanitised_name>.
create policy "read transfers for members" on storage.objects for select to authenticated
using(bucket_id='transfers' and public.is_member((split_part(name,'/',1))::uuid,(select auth.uid())));
create policy "upload transfers for accepted contacts" on storage.objects for insert to authenticated
with check(bucket_id='transfers' and public.can_message((split_part(name,'/',1))::uuid,(select auth.uid())));
create policy "remove own uploaded transfers" on storage.objects for delete to authenticated
using(bucket_id='transfers' and owner_id=(select auth.uid())::text);

-- Ensure message attachment paths stay inside their own conversation.
drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages for insert to authenticated
with check(sender_id=(select auth.uid()) and public.can_message(conversation_id,(select auth.uid()))
 and (
   (kind='text' and attachment_path is null)
   or (kind='file' and attachment_path like conversation_id::text || '/%')
 ));

-- Private ephemeral typing events. Only conversation members may subscribe or publish.
create policy "typing presence for participants" on realtime.messages for select to authenticated using (
 realtime.messages.extension='broadcast' and realtime.topic() like 'typing-%'
 and public.is_member((substring(realtime.topic() from 8))::uuid,(select auth.uid()))
);
create policy "send typing for participants" on realtime.messages for insert to authenticated with check (
 realtime.messages.extension='broadcast' and realtime.topic() like 'typing-%'
 and public.can_message((substring(realtime.topic() from 8))::uuid,(select auth.uid()))
);
