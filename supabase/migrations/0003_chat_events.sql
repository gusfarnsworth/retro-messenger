-- Apply after 0001_initial.sql and 0002_avatars.sql.
-- Persisted nudges; only accepted contacts can send or read these events.
create table if not exists public.chat_events (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 sender_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null check(kind='nudge'),
 created_at timestamptz not null default now()
);
create index if not exists chat_events_conversation_time on public.chat_events(conversation_id,created_at desc);
alter table public.chat_events enable row level security;
create policy "read own conversation nudges" on public.chat_events for select to authenticated using(public.is_member(conversation_id,(select auth.uid())));
create policy "send nudges to accepted contacts" on public.chat_events for insert to authenticated with check(sender_id=(select auth.uid()) and public.can_message(conversation_id,(select auth.uid())));
-- Prevent clients from spamming persisted nudges; each sender has a 15-second cooldown per conversation.
create or replace function public.enforce_nudge_cooldown() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.conversation_id::text || new.sender_id::text,0));
 if exists(select 1 from public.chat_events where conversation_id=new.conversation_id and sender_id=new.sender_id and created_at>now()-interval '15 seconds') then
   raise exception 'Please wait 15 seconds between nudges';
 end if;
 return new;
end;$$;
drop trigger if exists chat_event_nudge_cooldown on public.chat_events;
create trigger chat_event_nudge_cooldown before insert on public.chat_events for each row execute function public.enforce_nudge_cooldown();
do $$begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_events') then
  alter publication supabase_realtime add table public.chat_events;
 end if;
end$$;
