-- Retro Messenger 0.9 — broadcast polls in official NO REPLY System conversations.
-- Apply AFTER 0009_moderation_actions.sql in Supabase SQL Editor.
-- Poll creation/closing is admin-only; one vote per recipient; votes can be
-- changed until the poll is closed. Neither votes nor poll tables allow direct writes.

begin;

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

commit;
