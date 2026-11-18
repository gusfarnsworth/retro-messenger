-- Retro Messenger v1.0.2: 10 messages before + reported message + 10 after.
-- Install AFTER 0014_classic_social_features.sql.
-- Server-owned, immutable evidence snapshots; staff-only SELECT.
-- Existing reports keep their original single-message snapshot. Context capture
-- is enabled for NEW message reports so older cases are never misrepresented.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_report_message_context (
  report_id uuid NOT NULL REFERENCES public.user_reports(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN -10 AND 10),
  source_message_id uuid NOT NULL,  -- intentionally no FK: evidence survives message deletion
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,          -- intentionally no FK: evidence survives account deletion
  sender_name text NOT NULL,
  message_body text NOT NULL,
  message_kind text NOT NULL,
  attachment_path text,
  sent_at timestamptz NOT NULL,
  edited_at timestamptz,
  deleted_at timestamptz,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, position),
  UNIQUE (report_id, source_message_id)
);

-- Once a case is closed (or the reporter leaves the chat), evidence collection
-- cannot restart if the case is later reopened or the user rejoins the chat.
ALTER TABLE public.user_reports
  ADD COLUMN IF NOT EXISTS context_collection_stopped_at timestamptz;

CREATE INDEX IF NOT EXISTS report_context_anchors_idx
  ON public.user_report_message_context(conversation_id, sent_at)
  WHERE position = 0;
CREATE INDEX IF NOT EXISTS messages_context_order_idx
  ON public.messages(conversation_id, created_at, id);

ALTER TABLE public.user_report_message_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_report_message_context FROM public, anon, authenticated;
GRANT SELECT ON public.user_report_message_context TO authenticated;

DROP POLICY IF EXISTS "staff read conversation evidence" ON public.user_report_message_context;
CREATE POLICY "staff read conversation evidence" ON public.user_report_message_context
  FOR SELECT TO authenticated
  USING (public.is_messenger_staff());

-- This helper is only called by database triggers, never by browser clients.
-- Copies the message's content and sender name at the time of capture.
CREATE OR REPLACE FUNCTION public.record_report_context_message(
  p_report_id uuid, p_position integer, p_source_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF p_position NOT BETWEEN -10 AND 10 THEN
    RAISE EXCEPTION 'Invalid evidence position';
  END IF;

  INSERT INTO public.user_report_message_context (
    report_id,position,source_message_id,conversation_id,sender_id,
    sender_name,message_body,message_kind,attachment_path,sent_at,
    edited_at,deleted_at
  )
  SELECT p_report_id,p_position,m.id,m.conversation_id,m.sender_id,
    COALESCE(NULLIF(p.display_name,''),p.username,m.sender_id::text),
    m.body,m.kind,m.attachment_path,m.created_at,m.edited_at,m.deleted_at
  FROM public.messages m
  LEFT JOIN public.profiles p ON p.id=m.sender_id
  WHERE m.id=p_source_id
  ON CONFLICT DO NOTHING;
END;
$function$;

-- This AFTER INSERT trigger executes inside the validated submit_user_report RPC.
-- It takes the messages surrounding the *actual* database message, not a
-- client-supplied list that could be falsified or selectively omitted.
CREATE OR REPLACE FUNCTION public.capture_initial_report_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_conversation uuid;
  v_time timestamptz;
  v_prev record;
  v_next record;
  v_position integer;
BEGIN
  IF NEW.report_kind <> 'message' OR NEW.message_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT m.conversation_id,m.created_at
  INTO v_conversation,v_time
  FROM public.messages m WHERE m.id=NEW.message_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Previous messages, nearest first (-1, -2, ... -10).
  v_position := 0;
  FOR v_prev IN
    SELECT m.id
    FROM public.messages m
    WHERE m.conversation_id=v_conversation
      AND (m.created_at,m.id) < (v_time,NEW.message_id)
    ORDER BY m.created_at DESC,m.id DESC
    LIMIT 10
  LOOP
    v_position := v_position-1;
    PERFORM public.record_report_context_message(NEW.id,v_position,v_prev.id);
  END LOOP;

  -- The reported message is always position 0.
  PERFORM public.record_report_context_message(NEW.id,0,NEW.message_id);

  -- Messages that already followed it when the report was submitted.
  v_position := 0;
  FOR v_next IN
    SELECT m.id
    FROM public.messages m
    WHERE m.conversation_id=v_conversation
      AND (m.created_at,m.id) > (v_time,NEW.message_id)
    ORDER BY m.created_at,m.id
    LIMIT 10
  LOOP
    v_position := v_position+1;
    PERFORM public.record_report_context_message(NEW.id,v_position,v_next.id);
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS capture_report_context_on_submission ON public.user_reports;
CREATE TRIGGER capture_report_context_on_submission
  AFTER INSERT ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.capture_initial_report_context();

-- Freeze future capture when a case is resolved/dismissed. Reopening must
-- not create a misleading context that skips messages sent during closure.
CREATE OR REPLACE FUNCTION public.stop_report_context_when_closed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF OLD.status IN ('open','reviewing')
     AND NEW.status IN ('resolved','dismissed')
     AND NEW.context_collection_stopped_at IS NULL THEN
    NEW.context_collection_stopped_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS stop_report_context_on_close ON public.user_reports;
CREATE TRIGGER stop_report_context_on_close
  BEFORE UPDATE OF status ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.stop_report_context_when_closed();

-- Likewise, freeze a reporter's context if they leave this conversation.
-- They must not gain evidence from future chat history after rejoining.
CREATE OR REPLACE FUNCTION public.stop_report_context_when_member_leaves()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  UPDATE public.user_reports r
  SET context_collection_stopped_at=now()
  FROM public.user_report_message_context anchor
  WHERE r.id=anchor.report_id
    AND anchor.position=0
    AND anchor.conversation_id=OLD.conversation_id
    AND r.reporter_id=OLD.user_id
    AND r.context_collection_stopped_at IS NULL;
  RETURN OLD;
END;
$function$;
DROP TRIGGER IF EXISTS stop_report_context_on_member_exit ON public.conversation_members;
CREATE TRIGGER stop_report_context_on_member_exit
  AFTER DELETE ON public.conversation_members
  FOR EACH ROW EXECUTE FUNCTION public.stop_report_context_when_member_leaves();

-- A report created while a conversation is still active may have fewer than
-- ten subsequent messages. As new messages arrive, fill slots +1 through +10.
-- Lock each report row before reserving its next position to prevent duplicate
-- slots if multiple messages are sent simultaneously.
CREATE OR REPLACE FUNCTION public.capture_subsequent_report_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_report record;
  v_next_position integer;
BEGIN
  FOR v_report IN
    SELECT r.id
    FROM public.user_reports r
    JOIN public.user_report_message_context anchor
      ON anchor.report_id=r.id AND anchor.position=0
    WHERE anchor.conversation_id=NEW.conversation_id
      AND (NEW.created_at,NEW.id) > (anchor.sent_at,anchor.source_message_id)
      -- Do not record future messages after the reporter leaves the chat.
      AND EXISTS (
        SELECT 1 FROM public.conversation_members member
        WHERE member.conversation_id=NEW.conversation_id
          AND member.user_id=r.reporter_id
      )
      AND r.status IN ('open','reviewing')
      AND r.context_collection_stopped_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.user_report_message_context last_message
        WHERE last_message.report_id=r.id AND last_message.position=10
      )
    ORDER BY r.id
  LOOP
    -- Serialise concurrent messages filling the same report.
    PERFORM 1 FROM public.user_reports WHERE id=v_report.id FOR UPDATE;
    SELECT COALESCE(MAX(c.position),0)+1 INTO v_next_position
      FROM public.user_report_message_context c
      WHERE c.report_id=v_report.id AND c.position>0;

    IF v_next_position BETWEEN 1 AND 10 THEN
      PERFORM public.record_report_context_message(v_report.id,v_next_position,NEW.id);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS capture_report_context_on_message ON public.messages;
CREATE TRIGGER capture_report_context_on_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.capture_subsequent_report_context();

-- Trigger functions remain executable by triggers but not as public RPCs.
REVOKE ALL ON FUNCTION public.record_report_context_message(uuid,integer,uuid)
  FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.capture_initial_report_context()
  FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.capture_subsequent_report_context()
  FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.stop_report_context_when_closed()
  FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.stop_report_context_when_member_leaves()
  FROM public,anon,authenticated;

COMMIT;

-- Optional verification: staff-only evidence table and capture triggers.
-- SELECT to_regclass('public.user_report_message_context');
-- SELECT tgname FROM pg_trigger WHERE tgname IN
-- ('capture_report_context_on_submission','capture_report_context_on_message');
