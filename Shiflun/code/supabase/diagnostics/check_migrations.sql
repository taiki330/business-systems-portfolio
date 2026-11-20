-- SQL Editor でこのファイル全体を実行し、最後の SELECT の結果を確認する。
-- アプリのテーブル・データ・migration履歴には触れない診断用関数。
-- SQL Editor 手動実行は通常 supabase_migrations に記録されないため、
-- 「実行済みの証明」ではなく現在のDB構造との照合結果を返す。

CREATE OR REPLACE FUNCTION public.check_shiflun_migrations()
RETURNS TABLE (
  migration TEXT,
  assessment TEXT,
  found_checks INTEGER,
  total_checks INTEGER,
  missing_checks TEXT[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
WITH expected(migration, kind, object_name, detail) AS (
  VALUES
    ('001_initial_schema.sql', 'table', 'workers', ''),
    ('001_initial_schema.sql', 'table', 'manager_verifications', ''),
    ('001_initial_schema.sql', 'table', 'scout_requests', ''),
    ('002_phase2_industry_skills_availability.sql', 'column', 'workers', 'skill_tags'),
    ('002_phase2_industry_skills_availability.sql', 'table', 'worker_availability_slots', ''),
    ('003_phase3_manager_verification.sql', 'column', 'manager_verifications', 'store_name'),
    ('003_phase3_manager_verification.sql', 'constraint', 'manager_verifications', 'uq_manager_verifications_worker_id'),
    ('004_phase4_scout_requests.sql', 'column', 'scout_requests', 'store_name'),
    ('004_phase4_scout_requests.sql', 'column', 'scout_requests', 'preferred_work_date'),
    ('004_phase4_scout_requests.sql', 'column', 'scout_requests', 'preferred_start_time'),
    ('004_phase4_scout_requests.sql', 'column', 'scout_requests', 'preferred_end_time'),
    ('004_phase4_scout_requests.sql', 'column', 'scout_requests', 'offered_hourly_wage'),
    ('005_phase5_availability_work_date.sql', 'column', 'worker_availability_slots', 'work_date'),
    ('005_phase5_availability_work_date.sql', 'index', 'idx_worker_availability_slots_work_date', ''),
    ('006_phase5d_shift_status.sql', 'column', 'worker_availability_slots', 'status'),
    ('006_phase5d_shift_status.sql', 'column', 'worker_availability_slots', 'reviewed_at'),
    ('007_shift_periods.sql', 'table', 'shift_periods', ''),
    ('008_phase7_companies_stores_normalization.sql', 'table', 'companies', ''),
    ('008_phase7_companies_stores_normalization.sql', 'table', 'stores', ''),
    ('008_phase7_companies_stores_normalization.sql', 'column', 'workers', 'user_id'),
    ('008_phase7_companies_stores_normalization.sql', 'column', 'workers', 'current_store_id'),
    ('008_phase7_companies_stores_normalization.sql', 'column', 'manager_verifications', 'store_id'),
    ('008_phase7_companies_stores_normalization.sql', 'column', 'scout_requests', 'store_id'),
    ('008_phase7_companies_stores_normalization.sql', 'column', 'shift_periods', 'store_id'),
    ('008_phase7_companies_stores_normalization.sql', 'column', 'worker_availability_slots', 'store_id'),
    ('010_store_join_requests.sql', 'table', 'store_join_requests', ''),
    ('011_scout_status_join_profile.sql', 'column', 'scout_requests', 'status'),
    ('011_scout_status_join_profile.sql', 'column', 'store_join_requests', 'experience_years'),
    ('011_scout_status_join_profile.sql', 'column', 'store_join_requests', 'bio'),
    ('012_scout_shift_link_and_attendance.sql', 'column', 'worker_availability_slots', 'store_name'),
    ('012_scout_shift_link_and_attendance.sql', 'column', 'worker_availability_slots', 'company_name'),
    ('012_scout_shift_link_and_attendance.sql', 'column', 'worker_availability_slots', 'scout_request_id'),
    ('012_scout_shift_link_and_attendance.sql', 'column', 'worker_availability_slots', 'hourly_wage'),
    ('012_scout_shift_link_and_attendance.sql', 'column', 'worker_availability_slots', 'clock_in_at'),
    ('012_scout_shift_link_and_attendance.sql', 'column', 'worker_availability_slots', 'clock_out_at'),
    ('012_scout_shift_link_and_attendance.sql', 'column', 'worker_availability_slots', 'clock_in_lat'),
    ('012_scout_shift_link_and_attendance.sql', 'column', 'worker_availability_slots', 'clock_in_lng'),
    ('012_scout_shift_link_and_attendance.sql', 'column', 'worker_availability_slots', 'clock_out_lat'),
    ('012_scout_shift_link_and_attendance.sql', 'column', 'worker_availability_slots', 'clock_out_lng'),
    ('012_scout_shift_link_and_attendance.sql', 'column', 'worker_availability_slots', 'checkin_method'),
    ('012_scout_shift_link_and_attendance.sql', 'constraint', 'worker_availability_slots', 'chk_worker_availability_slots_checkin_method'),
    ('012_scout_shift_link_and_attendance.sql', 'index', 'idx_worker_availability_slots_scout_request_id', ''),
    ('013_self_report_join_and_worker_flags.sql', 'table', 'worker_flags', ''),
    ('013_self_report_join_and_worker_flags.sql', 'index', 'idx_worker_flags_worker_id', ''),
    ('013_self_report_join_and_worker_flags.sql', 'index', 'idx_worker_flags_status', ''),
    ('014_matching_profiles_chat_notifications.sql', 'column', 'workers', 'preferred_areas'),
    ('014_matching_profiles_chat_notifications.sql', 'column', 'stores', 'hourly_wage'),
    ('014_matching_profiles_chat_notifications.sql', 'column', 'stores', 'area'),
    ('014_matching_profiles_chat_notifications.sql', 'column', 'scout_requests', 'break_minutes'),
    ('014_matching_profiles_chat_notifications.sql', 'column', 'scout_requests', 'work_minutes'),
    ('014_matching_profiles_chat_notifications.sql', 'column', 'scout_requests', 'offered_total_yen'),
    ('014_matching_profiles_chat_notifications.sql', 'column', 'scout_requests', 'service_fee_percent'),
    ('014_matching_profiles_chat_notifications.sql', 'column', 'scout_requests', 'service_fee_yen'),
    ('014_matching_profiles_chat_notifications.sql', 'column', 'scout_requests', 'store_total_yen'),
    ('014_matching_profiles_chat_notifications.sql', 'table', 'scout_messages', ''),
    ('014_matching_profiles_chat_notifications.sql', 'table', 'app_notifications', ''),
    ('014_matching_profiles_chat_notifications.sql', 'view', 'worker_scout_stats', ''),
    ('014_matching_profiles_chat_notifications.sql', 'function', 'create_scouting_store(text,text,text,integer)', ''),
    ('014_matching_profiles_chat_notifications.sql', 'function', 'respond_to_scout(uuid,uuid,text)', ''),
    ('014_matching_profiles_chat_notifications.sql', 'trigger', 'scout_requests', 'prepare_scout_offer'),
    ('014_matching_profiles_chat_notifications.sql', 'trigger', 'scout_requests', 'notify_scout_event'),
    ('014_matching_profiles_chat_notifications.sql', 'trigger', 'scout_messages', 'check_scout_message'),
    ('014_matching_profiles_chat_notifications.sql', 'trigger', 'scout_messages', 'notify_chat_message')
), inspected AS (
  SELECT e.*,
    CASE e.kind
      WHEN 'table' THEN EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = e.object_name AND c.relkind IN ('r', 'p'))
      WHEN 'view' THEN EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = e.object_name AND c.relkind = 'v')
      WHEN 'index' THEN EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = e.object_name AND c.relkind IN ('i', 'I'))
      WHEN 'column' THEN EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = pg_catalog.to_regclass(pg_catalog.format('public.%I', e.object_name))
          AND a.attname = e.detail AND a.attnum > 0 AND NOT a.attisdropped)
      WHEN 'constraint' THEN EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = pg_catalog.to_regclass(pg_catalog.format('public.%I', e.object_name))
          AND c.conname = e.detail)
      WHEN 'trigger' THEN EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = pg_catalog.to_regclass(pg_catalog.format('public.%I', e.object_name))
          AND t.tgname = e.detail AND NOT t.tgisinternal)
      WHEN 'function' THEN pg_catalog.to_regprocedure('public.' || e.object_name) IS NOT NULL
      ELSE false
    END AS found
  FROM expected e
)
SELECT migration,
  CASE WHEN bool_and(found) THEN '構造上確認'
       WHEN bool_or(found) THEN '一部のみ確認'
       ELSE '確認できない' END AS assessment,
  count(*) FILTER (WHERE found)::integer AS found_checks,
  count(*)::integer AS total_checks,
  coalesce(array_agg(kind || ':' || object_name || CASE WHEN detail = '' THEN '' ELSE '.' || detail END ORDER BY kind, object_name, detail)
    FILTER (WHERE NOT found), ARRAY[]::text[]) AS missing_checks
FROM inspected
GROUP BY migration
ORDER BY migration;
$function$;

SELECT * FROM public.check_shiflun_migrations();
