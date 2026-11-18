-- Retro Messenger 0.9.3: colour validation and username availability.
-- Run only AFTER migrations through 0011 are present.
-- If 0012 is already applied, it is safe to rerun; the function is replaced.



-- === 0012_readable_message_formatting.sql ===

-- Retro Messenger v0.9.2 — readable message colours
-- Run after migrations 0001 through 0011.
-- Protects direct/group messages against clients attempting white, light, grey
-- or nearly-grey text. Existing messages are preserved; the app displays
-- unsafe historical colours using the standard dark text colour instead.

create or replace function public.message_color_is_readable(p_color text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_color bytea;
  v_r double precision;
  v_g double precision;
  v_b double precision;
  v_max double precision;
  v_min double precision;
  v_saturation double precision;
  v_luminance double precision;
begin
  if p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$' then
    return false;
  end if;

  v_color := pg_catalog.decode(pg_catalog.substr(p_color, 2), 'hex');
  v_r := pg_catalog.get_byte(v_color, 0)::double precision / 255.0;
  v_g := pg_catalog.get_byte(v_color, 1)::double precision / 255.0;
  v_b := pg_catalog.get_byte(v_color, 2)::double precision / 255.0;

  v_max := greatest(v_r, v_g, v_b);
  v_min := least(v_r, v_g, v_b);
  if v_max = 0 then return false; end if;

  v_saturation := (v_max - v_min) / v_max;
  -- 65% saturation excludes grey and greyish colours, including dark ones.
  if v_saturation < 0.65 then return false; end if;

  -- sRGB relative luminance. A value <= 0.1833 gives >= 4.5:1 contrast
  -- against the white chat background, including when text is not bold.
  v_luminance :=
    0.2126 * (case when v_r <= 0.04045 then v_r / 12.92 else power((v_r + 0.055) / 1.055, 2.4) end)
    + 0.7152 * (case when v_g <= 0.04045 then v_g / 12.92 else power((v_g + 0.055) / 1.055, 2.4) end)
    + 0.0722 * (case when v_b <= 0.04045 then v_b / 12.92 else power((v_b + 0.055) / 1.055, 2.4) end);
  return v_luminance <= 0.1833;
end;
$$;

-- NOT VALID preserves older rows that might have unreadable colours.
-- PostgreSQL still checks all new/updated rows after this migration.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'messages_format_color_readable'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages add constraint messages_format_color_readable
      check (
        pg_catalog.jsonb_typeof(format) = 'object'
        and (
          not (format ? 'color')
          or public.message_color_is_readable(format ->> 'color')
        )
      ) not valid;
  end if;
end;
$$;

-- The UI keeps invalid colours out of the picker, and the database protects
-- writes made directly through the public Supabase API.


-- === 0013_signup_username_availability.sql ===

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
