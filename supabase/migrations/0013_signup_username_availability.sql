-- Retro Messenger v0.9.3: username availability for unauthenticated sign-up.
-- Apply after migrations through 0012. Existing profiles.username UNIQUE remains
-- the definitive, race-safe enforcement of one account per username.
-- Email uniqueness is managed by Supabase Auth, NOT by an anon lookup RPC.

begin;

create or replace function public.username_is_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p_username is not null
    and p_username = pg_catalog.lower(pg_catalog.btrim(p_username))
    and p_username ~ '^[a-z0-9_]{3,20}$'
    and not exists (
      select 1 from public.profiles p where p.username = p_username
    );
$function$;

revoke all on function public.username_is_available(text) from public;
grant execute on function public.username_is_available(text) to anon,authenticated;

commit;

-- Optional verification:
-- select public.username_is_available('example_username');
