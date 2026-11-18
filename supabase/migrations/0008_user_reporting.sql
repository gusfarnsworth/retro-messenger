-- Retro Messenger v0.7.0 — private user and message reporting.
-- Apply after migrations 0001–0007 in Supabase SQL Editor.
-- Reports do NOT automatically ban, block, or penalise users.
-- Ordinary users submit via a validated RPC. Only authorised staff can read cases.

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  report_kind text not null check (report_kind in ('user','message')),
  reason text not null check (reason in (
    'harassment','hate_speech','spam','scam','impersonation','inappropriate_content','threats','other'
  )),
  details text not null default '' check (char_length(details)<=1500),
  message_id uuid references public.messages(id) on delete set null,
  evidence_body text,
  evidence_kind text,
  evidence_sent_at timestamptz,
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  staff_note text not null default '' check (char_length(staff_note)<=2000),
  reviewed_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (reporter_id<>target_id),
  check (report_kind='message' or (message_id is null and evidence_body is null))
);
create index if not exists user_reports_queue_idx on public.user_reports(status,created_at desc);
create index if not exists user_reports_reporter_recent_idx on public.user_reports(reporter_id,created_at desc);
create index if not exists user_reports_target_recent_idx on public.user_reports(target_id,created_at desc);

create table if not exists public.user_report_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.user_reports(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  previous_status text not null,
  next_status text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists user_report_actions_recent_idx on public.user_report_actions(report_id,created_at desc);

alter table public.user_reports enable row level security;
alter table public.user_report_actions enable row level security;
revoke all on public.user_reports from public, anon, authenticated;
revoke all on public.user_report_actions from public, anon, authenticated;
grant select on public.user_reports to authenticated;
grant select on public.user_report_actions to authenticated;

-- Staff-only access, including case notes and the full evidence snapshot.
-- Regular users are not permitted to list or inspect any cases, even their own;
-- the submission RPC only returns a generated report reference.
drop policy if exists "staff can inspect reports" on public.user_reports;
create policy "staff can inspect reports" on public.user_reports
for select to authenticated using (public.is_messenger_staff());
drop policy if exists "staff can inspect report audit" on public.user_report_actions;
create policy "staff can inspect report audit" on public.user_report_actions
for select to authenticated using (public.is_messenger_staff());

create or replace function public.submit_user_report(
  p_target_id uuid,
  p_reason text,
  p_details text default '',
  p_message_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_reporter uuid := auth.uid();
  v_message public.messages%rowtype;
  v_id uuid;
  v_kind text := case when p_message_id is null then 'user' else 'message' end;
begin
  if v_reporter is null then
    raise exception 'Sign in to submit a report' using errcode = '42501';
  end if;
  if p_target_id is null or p_target_id = v_reporter or not exists (
    select 1 from public.profiles where id = p_target_id
  ) then
    raise exception 'Select another valid account to report';
  end if;
  if p_reason is null or p_reason not in (
    'harassment','hate_speech','spam','scam','impersonation','inappropriate_content','threats','other'
  ) then
    raise exception 'Select a valid report reason';
  end if;
  if char_length(coalesce(p_details,'')) > 1500 then
    raise exception 'Report details cannot exceed 1500 characters';
  end if;
  if p_reason = 'other' and char_length(btrim(coalesce(p_details,''))) < 10 then
    raise exception 'Please explain this report in at least 10 characters';
  end if;

  if p_message_id is not null then
    select m.* into v_message from public.messages m where m.id = p_message_id;
    if not found or v_message.sender_id <> p_target_id or not exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = v_message.conversation_id and cm.user_id = v_reporter
    ) then
      raise exception 'The selected message is unavailable or not reportable' using errcode = '42501';
    end if;
  end if;

  -- Prevent parallel submissions from circumventing limits.
  perform pg_advisory_xact_lock(hashtextextended(v_reporter::text || ':reports',0));
  if (select count(*) from public.user_reports
    where reporter_id = v_reporter and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'Daily report limit reached. Please try again later';
  end if;
  if exists (
    select 1 from public.user_reports r
    where r.reporter_id = v_reporter and r.target_id = p_target_id
      and r.report_kind = v_kind
      and r.message_id is not distinct from p_message_id
      and r.created_at > now() - interval '24 hours'
  ) then
    raise exception 'You have already reported this account or message recently';
  end if;

  insert into public.user_reports (
    reporter_id,target_id,report_kind,reason,details,message_id,
    evidence_body,evidence_kind,evidence_sent_at
  ) values (
    v_reporter,p_target_id,v_kind,p_reason,btrim(coalesce(p_details,'')),p_message_id,
    case when p_message_id is not null then v_message.body else null end,
    case when p_message_id is not null then v_message.kind else null end,
    case when p_message_id is not null then v_message.created_at else null end
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_user_report(uuid,text,text,uuid) from public,anon;
grant execute on function public.submit_user_report(uuid,text,text,uuid) to authenticated;

create or replace function public.review_user_report(
  p_report_id uuid,
  p_status text,
  p_staff_note text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_previous text;
  v_note text := btrim(coalesce(p_staff_note,''));
begin
  if v_actor is null or not exists (
    select 1 from public.messenger_staff s
    where s.user_id=v_actor and s.role in ('staff','admin')
  ) then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('open','reviewing','resolved','dismissed') then
    raise exception 'Invalid report status';
  end if;
  if char_length(v_note)>2000 then
    raise exception 'Staff note is too long';
  end if;
  select status into v_previous from public.user_reports
    where id=p_report_id for update;
  if not found then raise exception 'Report not found'; end if;

  update public.user_reports
    set status=p_status, staff_note=v_note, reviewed_by=v_actor, updated_at=now()
    where id=p_report_id;
  insert into public.user_report_actions(report_id,actor_id,previous_status,next_status,note)
    values(p_report_id,v_actor,v_previous,p_status,v_note);
end;
$$;
revoke all on function public.review_user_report(uuid,text,text) from public,anon;
grant execute on function public.review_user_report(uuid,text,text) to authenticated;

-- No public Realtime publication: moderators poll the queue while viewing it.
