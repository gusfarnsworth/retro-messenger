-- Retro Messenger 1.0: classic social features, private chat controls and moderation appeals
-- Prerequisite: all migrations through 0013.
-- Run as Supabase project owner. Idempotent for a single installation.
BEGIN;

UPDATE storage.buckets SET allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','image/gif'] WHERE id='avatars';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS now_playing_title text NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS now_playing_artist text NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS now_playing_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_now_playing_title_size;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_now_playing_title_size CHECK (char_length(now_playing_title)<=100);
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_now_playing_artist_size;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_now_playing_artist_size CHECK (char_length(now_playing_artist)<=100);

-- Simple per-user privacy controls. Do NOT expose account emails.
CREATE TABLE IF NOT EXISTS public.user_privacy_settings (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  allow_contact_requests boolean NOT NULL DEFAULT true,
  discoverable boolean NOT NULL DEFAULT true,
  show_music boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_privacy_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_privacy_settings FROM public,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.user_privacy_settings TO authenticated;
DROP POLICY IF EXISTS "own privacy read" ON public.user_privacy_settings;
CREATE POLICY "own privacy read" ON public.user_privacy_settings FOR SELECT TO authenticated USING (user_id=(select auth.uid()));
DROP POLICY IF EXISTS "own privacy insert" ON public.user_privacy_settings;
CREATE POLICY "own privacy insert" ON public.user_privacy_settings FOR INSERT TO authenticated WITH CHECK(user_id=(select auth.uid()));
DROP POLICY IF EXISTS "own privacy update" ON public.user_privacy_settings;
CREATE POLICY "own privacy update" ON public.user_privacy_settings FOR UPDATE TO authenticated USING(user_id=(select auth.uid())) WITH CHECK(user_id=(select auth.uid()));

-- SECURITY DEFINER helpers avoid RLS hiding somebody else's own privacy row.
CREATE OR REPLACE FUNCTION public.can_request_contact(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
  SELECT NOT EXISTS(SELECT 1 FROM public.user_privacy_settings WHERE user_id=p_user AND allow_contact_requests=false)
$fn$;
CREATE OR REPLACE FUNCTION public.is_profile_discoverable(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
  SELECT NOT EXISTS(SELECT 1 FROM public.user_privacy_settings WHERE user_id=p_user AND discoverable=false)
$fn$;
REVOKE ALL ON FUNCTION public.can_request_contact(uuid),public.is_profile_discoverable(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_request_contact(uuid),public.is_profile_discoverable(uuid) TO authenticated;

-- Apply opt-out to direct contact requests without compromising authentication.
DROP POLICY IF EXISTS "create contact request" ON public.contact_requests;
CREATE POLICY "create contact request" ON public.contact_requests FOR INSERT TO authenticated
WITH CHECK(sender_id=(select auth.uid()) AND public.moderation_can_send((select auth.uid())) AND status='pending'
  AND NOT public.is_contact(sender_id,receiver_id)
  AND NOT EXISTS(SELECT 1 FROM public.user_blocks b WHERE (b.blocker_id=sender_id AND b.blocked_id=receiver_id) OR (b.blocker_id=receiver_id AND b.blocked_id=sender_id))
  AND public.can_request_contact(receiver_id));

-- Profile discovery remains available for contact/group message display, while
-- usernames marked private are omitted for non-contacts. Note: exact username
-- availability checks still reveal whether a username is taken.
DROP POLICY IF EXISTS "authenticated can discover usernames" ON public.profiles;
CREATE POLICY "authenticated can discover usernames" ON public.profiles FOR SELECT TO authenticated
USING (id=(select auth.uid()) OR public.is_contact(id,(select auth.uid())) OR public.is_messenger_staff()
  OR public.is_profile_discoverable(profiles.id));

-- Message updates are made ONLY through security-checked RPCs.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE OR REPLACE FUNCTION public.edit_own_message(p_message uuid,p_body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE m public.messages%rowtype;
BEGIN
  SELECT * INTO m FROM public.messages WHERE id=p_message FOR UPDATE;
  IF NOT FOUND OR m.sender_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'You can only edit your own messages' USING errcode='42501'; END IF;
  IF m.deleted_at IS NOT NULL OR coalesce(m.kind,'text')<>'text' OR m.created_at < now()-interval '15 minutes' THEN
    RAISE EXCEPTION 'This message cannot be edited'; END IF;
  IF NOT public.moderation_can_send(auth.uid()) THEN RAISE EXCEPTION 'Messaging is restricted' USING errcode='42501'; END IF;
  IF char_length(btrim(coalesce(p_body,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Message length must be 1–2000 characters'; END IF;
  UPDATE public.messages SET body=btrim(p_body),edited_at=now() WHERE id=p_message;
END;
$fn$;
CREATE OR REPLACE FUNCTION public.delete_own_message(p_message uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE m public.messages%rowtype;
BEGIN
  SELECT * INTO m FROM public.messages WHERE id=p_message FOR UPDATE;
  IF NOT FOUND OR m.sender_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'You can only remove your own messages' USING errcode='42501'; END IF;
  IF m.deleted_at IS NULL THEN
    UPDATE public.messages SET body='Message deleted',attachment_path=null,deleted_at=now(),edited_at=null WHERE id=p_message;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.edit_own_message(uuid,text), public.delete_own_message(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.edit_own_message(uuid,text), public.delete_own_message(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('👍','❤️','😂','😮','😢','🎉')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id,user_id,emoji)
);
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_reactions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.message_reactions TO authenticated;
DROP POLICY IF EXISTS "members read reactions" ON public.message_reactions;
CREATE POLICY "members read reactions" ON public.message_reactions FOR SELECT TO authenticated
USING(EXISTS (SELECT 1 FROM public.messages m WHERE m.id=message_id AND public.is_member(m.conversation_id,(select auth.uid()))));
DROP POLICY IF EXISTS "members add reactions" ON public.message_reactions;
CREATE POLICY "members add reactions" ON public.message_reactions FOR INSERT TO authenticated
WITH CHECK(user_id=(select auth.uid()) AND public.moderation_can_send((select auth.uid()))
  AND EXISTS(SELECT 1 FROM public.messages m WHERE m.id=message_id AND m.deleted_at IS NULL AND public.is_member(m.conversation_id,(select auth.uid()))));
DROP POLICY IF EXISTS "members remove own reactions" ON public.message_reactions;
CREATE POLICY "members remove own reactions" ON public.message_reactions FOR DELETE TO authenticated USING(user_id=(select auth.uid()));

-- Reversible moderator roles for groups. The owner always has full control.
CREATE TABLE IF NOT EXISTS public.group_moderators (
  group_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  promoted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(group_id,user_id)
);
ALTER TABLE public.group_moderators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.group_moderators FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.group_moderators TO authenticated;
DROP POLICY IF EXISTS "group members read moderators" ON public.group_moderators;
CREATE POLICY "group members read moderators" ON public.group_moderators FOR SELECT TO authenticated
USING(public.is_member(group_id,(select auth.uid())));
CREATE OR REPLACE FUNCTION public.manage_group(p_group uuid,p_operation text,p_target uuid DEFAULT NULL,p_title text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_me uuid:=auth.uid();v_owner uuid;v_is_mod boolean;
BEGIN
  SELECT owner_id INTO v_owner FROM public.conversations WHERE id=p_group AND type='group' FOR UPDATE;
  IF NOT FOUND OR NOT public.is_member(p_group,v_me) OR NOT public.moderation_can_send(v_me) THEN RAISE EXCEPTION 'Group unavailable' USING errcode='42501'; END IF;
  v_is_mod:=exists(SELECT 1 FROM public.group_moderators WHERE group_id=p_group AND user_id=v_me);
  IF p_operation IN ('promote','demote') THEN
    IF v_owner IS DISTINCT FROM v_me THEN RAISE EXCEPTION 'Only the owner can manage moderators' USING errcode='42501'; END IF;
    IF p_target IS NULL OR p_target=v_owner OR NOT public.is_member(p_group,p_target) THEN RAISE EXCEPTION 'Select an eligible member'; END IF;
    IF p_operation='promote' THEN INSERT INTO public.group_moderators(group_id,user_id) VALUES(p_group,p_target) ON CONFLICT DO NOTHING;
    ELSE DELETE FROM public.group_moderators WHERE group_id=p_group AND user_id=p_target; END IF;
  ELSIF p_operation='kick' THEN
    IF v_owner IS DISTINCT FROM v_me AND NOT v_is_mod THEN RAISE EXCEPTION 'Moderator permission required' USING errcode='42501'; END IF;
    IF p_target IS NULL OR p_target=v_owner OR p_target=v_me THEN RAISE EXCEPTION 'Cannot remove this member'; END IF;
    IF v_owner IS DISTINCT FROM v_me AND EXISTS (SELECT 1 FROM public.group_moderators WHERE group_id=p_group AND user_id=p_target) THEN RAISE EXCEPTION 'Moderators cannot remove other moderators'; END IF;
    DELETE FROM public.conversation_members WHERE conversation_id=p_group AND user_id=p_target;
    DELETE FROM public.group_moderators WHERE group_id=p_group AND user_id=p_target;
  ELSIF p_operation='rename' THEN
    IF v_owner IS DISTINCT FROM v_me AND NOT v_is_mod THEN RAISE EXCEPTION 'Moderator permission required' USING errcode='42501'; END IF;
    IF char_length(btrim(coalesce(p_title,''))) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'Group name must be 2–60 characters'; END IF;
    UPDATE public.conversations SET group_title=btrim(p_title) WHERE id=p_group;
  ELSE RAISE EXCEPTION 'Unknown group operation';
  END IF;
END;
$fn$;
-- Group owners and appointed moderators may invite existing contacts.
CREATE OR REPLACE FUNCTION public.add_group_member(p_group_id uuid,p_new_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_me uuid:=auth.uid();v_owner uuid;v_count integer;
BEGIN
  IF NOT public.moderation_can_send(v_me) THEN RAISE EXCEPTION 'Messaging is restricted' USING errcode='42501'; END IF;
  SELECT owner_id INTO v_owner FROM public.conversations WHERE id=p_group_id AND type='group' FOR UPDATE;
  IF NOT FOUND OR (v_owner IS DISTINCT FROM v_me AND NOT EXISTS(SELECT 1 FROM public.group_moderators WHERE group_id=p_group_id AND user_id=v_me)) THEN
    RAISE EXCEPTION 'Owner or moderator permission required' USING errcode='42501'; END IF;
  IF p_new_user IS NULL OR NOT public.is_contact(v_me,p_new_user) OR NOT public.is_contact(p_new_user,v_me)
    OR public.moderation_is_suspended(p_new_user) THEN RAISE EXCEPTION 'Select an accepted contact'; END IF;
  SELECT count(*) INTO v_count FROM public.conversation_members WHERE conversation_id=p_group_id;
  IF v_count>=12 THEN RAISE EXCEPTION 'Group member limit reached'; END IF;
  INSERT INTO public.conversation_members(conversation_id,user_id) VALUES(p_group_id,p_new_user) ON CONFLICT DO NOTHING;
END;
$fn$;
REVOKE ALL ON FUNCTION public.add_group_member(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_group_member(uuid,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.manage_group(uuid,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_group(uuid,text,uuid,text) TO authenticated;

-- Noughts & Crosses: turn-based, server validated, one active game per group.
CREATE TABLE IF NOT EXISTS public.group_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  player_x uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player_o uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  board text NOT NULL DEFAULT '.........' CHECK (board ~ '^[XO.]{9}$'),
  turn_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  winner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','won','draw')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(player_x<>player_o)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_game_per_group ON public.group_games(group_id) WHERE state='active';
ALTER TABLE public.group_games ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.group_games FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.group_games TO authenticated;
DROP POLICY IF EXISTS "members view group games" ON public.group_games;
CREATE POLICY "members view group games" ON public.group_games FOR SELECT TO authenticated USING(public.is_member(group_id,(select auth.uid())));
CREATE OR REPLACE FUNCTION public.start_group_game(p_group uuid,p_opponent uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_me uuid:=auth.uid();v_id uuid;
BEGIN
 IF NOT public.is_member(p_group,v_me) OR NOT public.is_member(p_group,p_opponent) OR v_me=p_opponent OR NOT public.moderation_can_send(v_me) THEN
   RAISE EXCEPTION 'Both players must belong to this group' USING errcode='42501'; END IF;
 INSERT INTO public.group_games(group_id,player_x,player_o,turn_id) VALUES(p_group,v_me,p_opponent,v_me) RETURNING id INTO v_id;
 RETURN v_id;
END;
$fn$;
CREATE OR REPLACE FUNCTION public.play_group_game(p_game uuid,p_cell integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE g public.group_games%rowtype; v_mark text; v_board text; v_won boolean:=false; v_seq int[]; v_i integer;
BEGIN
 SELECT * INTO g FROM public.group_games WHERE id=p_game FOR UPDATE;
 IF NOT FOUND OR g.state<>'active' OR auth.uid()<>g.turn_id OR NOT public.is_member(g.group_id,auth.uid()) OR NOT public.moderation_can_send(auth.uid()) THEN
   RAISE EXCEPTION 'Not your turn or game unavailable' USING errcode='42501'; END IF;
 IF p_cell NOT BETWEEN 0 AND 8 OR substring(g.board from p_cell+1 for 1)<>'.' THEN RAISE EXCEPTION 'Select an empty square'; END IF;
 v_mark:=case when auth.uid()=g.player_x then 'X' else 'O' end;
 v_board:=overlay(g.board placing v_mark from p_cell+1 for 1);
 FOREACH v_seq SLICE 1 IN ARRAY ARRAY[[1,2,3],[4,5,6],[7,8,9],[1,4,7],[2,5,8],[3,6,9],[1,5,9],[3,5,7]] LOOP
   IF substring(v_board from v_seq[1] for 1)=v_mark AND substring(v_board from v_seq[2] for 1)=v_mark AND substring(v_board from v_seq[3] for 1)=v_mark THEN v_won:=true; EXIT; END IF;
 END LOOP;
 UPDATE public.group_games SET board=v_board, updated_at=now(),winner_id=case when v_won then auth.uid() else null end,
   state=case when v_won then 'won' when position('.' in v_board)=0 then 'draw' else 'active' end,
   turn_id=case when auth.uid()=g.player_x then g.player_o else g.player_x end WHERE id=p_game;
END;
$fn$;
REVOKE ALL ON FUNCTION public.start_group_game(uuid,uuid),public.play_group_game(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_group_game(uuid,uuid),public.play_group_game(uuid,integer) TO authenticated;

-- The appellant alone can submit; staff can review using a guarded RPC.
CREATE TABLE IF NOT EXISTS public.moderation_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appellant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 20 AND 2000),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','declined')),
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  staff_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_appeal_per_user ON public.moderation_appeals(appellant_id) WHERE state='pending';
ALTER TABLE public.moderation_appeals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderation_appeals FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.moderation_appeals TO authenticated;
DROP POLICY IF EXISTS "appeal view own or staff" ON public.moderation_appeals;
CREATE POLICY "appeal view own or staff" ON public.moderation_appeals FOR SELECT TO authenticated USING(appellant_id=(select auth.uid()) OR public.is_messenger_staff());
CREATE OR REPLACE FUNCTION public.submit_moderation_appeal(p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 20 AND 2000 THEN RAISE EXCEPTION 'Appeal must be 20–2000 characters'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.moderation_actions a WHERE a.target_id=auth.uid() AND a.action_type='suspension' AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>now())) THEN
   RAISE EXCEPTION 'There is no active suspension to appeal'; END IF;
 INSERT INTO public.moderation_appeals(appellant_id,reason) VALUES(auth.uid(),btrim(p_reason)) RETURNING id INTO v_id;
 RETURN v_id;
END;
$fn$;
CREATE OR REPLACE FUNCTION public.review_moderation_appeal(p_appeal uuid,p_accept boolean,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_target uuid;
BEGIN
 IF NOT public.is_messenger_staff() THEN RAISE EXCEPTION 'Staff only' USING errcode='42501'; END IF;
 IF char_length(btrim(coalesce(p_note,''))) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Enter a review note of 10–1000 characters'; END IF;
 SELECT appellant_id INTO v_target FROM public.moderation_appeals WHERE id=p_appeal AND state='pending' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Appeal already reviewed or not found'; END IF;
 UPDATE public.moderation_appeals SET state=case when p_accept then 'accepted' else 'declined' end,reviewer_id=auth.uid(),staff_note=btrim(p_note),reviewed_at=now() WHERE id=p_appeal;
 IF p_accept THEN
    UPDATE public.moderation_actions SET revoked_at=now(),revoked_by=auth.uid(),revoke_reason=left('Accepted moderation appeal: '||btrim(p_note),500)
    WHERE target_id=v_target AND action_type='suspension' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now());
 END IF;
 INSERT INTO public.system_direct_messages(recipient_id,admin_sender_id,subject,body,message_kind)
 VALUES(v_target,auth.uid(),'Moderation appeal reviewed',case when p_accept then 'Your appeal was accepted and your active suspension has been lifted. ' else 'Your appeal was declined. ' end||btrim(p_note),'admin');
END;
$fn$;
REVOKE ALL ON FUNCTION public.submit_moderation_appeal(text),public.review_moderation_appeal(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_moderation_appeal(text),public.review_moderation_appeal(uuid,boolean,text) TO authenticated;

-- Realtime pushes message reaction changes to participating clients (RLS applies).
DO $fn$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='message_reactions') THEN
   ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
 END IF;
END $fn$;

COMMIT;
