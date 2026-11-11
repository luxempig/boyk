-- 1. Alert the team when something is reported.
--    Each new (or reopened) report pings the notify-report edge function,
--    which re-reads the report with the service role and sends a Telegram
--    message. The request carries only the report's id, so no secret has to
--    live in the database.

CREATE OR REPLACE FUNCTION public.notify_report_created() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    PERFORM net.http_post(
        url := 'https://ggmkhgmrjtaacbcgnuwy.supabase.co/functions/v1/notify-report',
        body := jsonb_build_object('table', TG_TABLE_NAME, 'id', NEW.id),
        headers := '{"Content-Type": "application/json"}'::jsonb
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- An alert failing must never stop the report from being saved.
    RAISE WARNING 'notify_report_created: %', SQLERRM;
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.notify_report_created() FROM PUBLIC, anon, authenticated;

-- A repeat report from the same person upserts the row and sets it back to
-- open, so alert on that too.
CREATE OR REPLACE TRIGGER boycott_reports_notify
    AFTER INSERT OR UPDATE OF status ON public.boycott_reports
    FOR EACH ROW
    WHEN (NEW.status = 'open')
    EXECUTE FUNCTION public.notify_report_created();

CREATE OR REPLACE TRIGGER content_reports_notify
    AFTER INSERT OR UPDATE OF status ON public.content_reports
    FOR EACH ROW
    WHEN (NEW.status = 'open')
    EXECUTE FUNCTION public.notify_report_created();

-- 2. Hide boycotts made by anyone the viewer has blocked, or who has blocked
--    the viewer, matching how get_feed treats posts.

CREATE OR REPLACE FUNCTION "public"."get_public_boycotts"() RETURNS TABLE("id" "uuid", "name" character varying, "description" "text", "is_public" boolean, "created_at" timestamp with time zone, "creator_id" "uuid", "tracker_count" bigint, "boycott_companies" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id,
        b.name,
        b.description,
        b.is_public,
        b.created_at,
        b.creator_id,
        (SELECT COUNT(*) FROM adopted_boycotts ab JOIN profiles ap ON ap.id = ab.user_id
            WHERE ab.boycott_id = b.id AND NOT COALESCE(ap.is_test_user, false)) AS tracker_count,
        COALESCE(
            (SELECT jsonb_agg(
                jsonb_build_object(
                    'id', bc.id,
                    'company_id', bc.company_id,
                    'block_owns', bc.block_owns,
                    'block_owned_by', bc.block_owned_by,
                    'block_suppliers', bc.block_suppliers,
                    'block_brands', bc.block_brands,
                    'block_customers', bc.block_customers,
                    'added_at', bc.added_at,
                    'companies', jsonb_build_object(
                        'id', c.id,
                        'name', c.name,
                        'description', c.description,
                        'website', c.website,
                        'logo_url', c.logo_url,
                        'lei', c.lei,
                        'wikidata_qid', c.wikidata_qid
                    )
                )
            )
            FROM boycott_companies bc
            LEFT JOIN companies c ON c.id = bc.company_id
            WHERE bc.boycott_id = b.id),
            '[]'::jsonb
        ) AS boycott_companies
    FROM boycotts b
    LEFT JOIN profiles p ON p.id = b.creator_id
    WHERE b.is_public = true
      AND (
          (NOT b.is_seed AND NOT COALESCE(p.is_test_user, false))
          OR (SELECT s.enabled FROM app_settings s WHERE s.key = 'show_seed_boycotts')
      )
      AND NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = b.creator_id)
             OR (ub.blocker_id = b.creator_id AND ub.blocked_id = auth.uid())
      )
    ORDER BY
        (SELECT COUNT(*) FROM adopted_boycotts ab JOIN profiles ap ON ap.id = ab.user_id
            WHERE ab.boycott_id = b.id AND NOT COALESCE(ap.is_test_user, false)) DESC,
        b.created_at DESC;
END;
$$;
