-- Diagnostic only: does not create or change database tables.
-- Run in Supabase SQL Editor to check whether v1.0.0 migration 0014 has been installed.
SELECT expected.table_name,
       CASE WHEN to_regclass('public.' || expected.table_name) IS NOT NULL
            THEN 'INSTALLED' ELSE 'MISSING' END AS status
FROM (VALUES
  ('message_reactions'),
  ('user_privacy_settings'),
  ('moderation_appeals'),
  ('group_moderators'),
  ('group_games')
) AS expected(table_name);

-- Once 0014 has run successfully (and all rows say INSTALLED), refresh the API cache:
-- NOTIFY pgrst, 'reload schema';
