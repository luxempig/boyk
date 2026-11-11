-- Baseline: the production schema as of 2026-09-25, dumped with `supabase db dump`.
--
-- The tables, enums and hardened RPCs this app depends on were first created by
-- hand in the SQL editor (documents/reference/schema.sql and the legacy root
-- migrations/ dir, which CI never applied), so a fresh database built from
-- supabase/migrations/ alone was missing them or, worse, had the pre-audit
-- versions. This file makes `supabase db reset` rebuild what production runs.
-- It replaces the 46 earlier migrations (kept in documents/legacy-migrations/)
-- and is recorded as applied in production, so `db push` never runs it there.
--
-- Deliberately not included: the pg_cron job `reporting_connection` (every
-- 5 minutes, calls the sync-to-sheets edge function). Its command names
-- production's URL, so a rebuilt local or staging database must not run it;
-- create it by hand where it belongs.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."boycott_report_reason" AS ENUM (
    'spam',
    'misinformation',
    'harassment',
    'off_topic',
    'duplicate',
    'illegal',
    'inappropriate',
    'other'
);


ALTER TYPE "public"."boycott_report_reason" OWNER TO "postgres";


CREATE TYPE "public"."connection_type" AS ENUM (
    'owns',
    'owned_by',
    'supplier'
);


ALTER TYPE "public"."connection_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_follow_request"("p_requester_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    -- Create the follow relationship
    INSERT INTO user_follows (follower_id, following_id)
    VALUES (p_requester_id, auth.uid());

    -- Delete the request
    DELETE FROM follow_requests
    WHERE requester_id = p_requester_id AND target_user_id = auth.uid();
  END;
  $$;


ALTER FUNCTION "public"."accept_follow_request"("p_requester_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_boycott_comment"("p_boycott_id" "uuid", "p_content" "text", "p_label" "text" DEFAULT NULL::"text", "p_media_url" "text" DEFAULT NULL::"text", "p_media_type" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_comment_id UUID;
    v_is_public BOOLEAN;
    v_creator_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_label IS NOT NULL AND p_label NOT IN ('alternative', 'correction') THEN
        RAISE EXCEPTION 'Invalid label: must be NULL, alternative, or correction';
    END IF;

    SELECT is_public, creator_id INTO v_is_public, v_creator_id
    FROM boycotts WHERE id = p_boycott_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Boycott not found';
    END IF;

    IF NOT v_is_public AND v_creator_id != v_user_id THEN
        RAISE EXCEPTION 'Cannot comment on private boycotts you do not own';
    END IF;

    v_comment_id := gen_random_uuid();

    INSERT INTO boycott_comments (id, boycott_id, user_id, content, label, media_url, media_type)
    VALUES (v_comment_id, p_boycott_id, v_user_id, p_content, p_label, p_media_url, p_media_type);

    RETURN v_comment_id;
END;
$$;


ALTER FUNCTION "public"."add_boycott_comment"("p_boycott_id" "uuid", "p_content" "text", "p_label" "text", "p_media_url" "text", "p_media_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_company_to_boycott"("p_boycott_id" "uuid", "p_company_id" "text", "p_company_name" "text" DEFAULT NULL::"text", "p_company_logo_url" "text" DEFAULT NULL::"text", "p_block_owns" boolean DEFAULT false, "p_block_owned_by" boolean DEFAULT false, "p_block_suppliers" boolean DEFAULT false, "p_block_brands" boolean DEFAULT false, "p_block_customers" boolean DEFAULT false) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
    resolved_id UUID;
    v_logo_url TEXT;
    v_lei TEXT;
    v_qid TEXT;
BEGIN
    -- Verify caller owns this boycott
    IF NOT EXISTS (
        SELECT 1 FROM boycotts WHERE id = p_boycott_id AND creator_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Not authorized to modify this boycott';
    END IF;

    -- Both wikimedia hosts have served https for years; a plaintext URL is
    -- blocked by iOS App Transport Security and triggers Mixed Content on web.
    v_logo_url := CASE
        WHEN p_company_logo_url LIKE 'http://%' THEN 'https://' || substring(p_company_logo_url FROM 8)
        ELSE p_company_logo_url
    END;
    v_lei := CASE WHEN p_company_id ~ '^[A-Z0-9]{20}$' THEN p_company_id ELSE NULL END;
    v_qid := CASE WHEN p_company_id ~ '^Q\d+$' THEN p_company_id ELSE NULL END;

    -- Try to resolve the company ID (UUID, LEI, Wikidata QID, or name)
    resolved_id := resolve_company_id(p_company_id);

    IF resolved_id IS NOT NULL THEN
        -- Fill in whatever the existing row is missing. COALESCE(existing, new)
        -- never overwrites a value that is already set.
        UPDATE companies SET
            logo_url     = COALESCE(logo_url, v_logo_url),
            lei          = COALESCE(lei, v_lei),
            wikidata_qid = COALESCE(wikidata_qid, v_qid)
        WHERE id = resolved_id;
    ELSIF p_company_name IS NOT NULL THEN
        -- Not found: create the company in Supabase
        INSERT INTO companies (name, logo_url, lei, wikidata_qid)
        VALUES (p_company_name, v_logo_url, v_lei, v_qid)
        ON CONFLICT (name) DO UPDATE SET
            lei = COALESCE(EXCLUDED.lei, companies.lei),
            wikidata_qid = COALESCE(EXCLUDED.wikidata_qid, companies.wikidata_qid),
            logo_url = COALESCE(EXCLUDED.logo_url, companies.logo_url)
        RETURNING id INTO resolved_id;
    END IF;

    IF resolved_id IS NULL THEN
        RAISE EXCEPTION 'Company not found and no name provided for auto-creation';
    END IF;

    -- Check for duplicates
    IF EXISTS (
        SELECT 1 FROM boycott_companies
        WHERE boycott_id = p_boycott_id AND company_id = resolved_id
    ) THEN
        RAISE EXCEPTION 'Company already exists in this boycott';
    END IF;

    INSERT INTO boycott_companies (
        boycott_id, company_id, block_owns, block_owned_by, block_suppliers, block_brands, block_customers
    ) VALUES (
        p_boycott_id, resolved_id, p_block_owns, p_block_owned_by, p_block_suppliers, p_block_brands, p_block_customers
    );
END;
$_$;


ALTER FUNCTION "public"."add_company_to_boycott"("p_boycott_id" "uuid", "p_company_id" "text", "p_company_name" "text", "p_company_logo_url" "text", "p_block_owns" boolean, "p_block_owned_by" boolean, "p_block_suppliers" boolean, "p_block_brands" boolean, "p_block_customers" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."adopt_boycott"("p_boycott_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_boycott_id IS NULL THEN
    RAISE EXCEPTION 'boycott_id is required';
  END IF;

  INSERT INTO adopted_boycotts (user_id, boycott_id)
  VALUES (v_uid, p_boycott_id)
  ON CONFLICT (user_id, boycott_id) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."adopt_boycott"("p_boycott_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."block_user"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
    END IF;
    IF p_user_id = v_uid THEN
        RAISE EXCEPTION 'cannot block yourself' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'user not found' USING ERRCODE = '22023';
    END IF;

    INSERT INTO user_blocks (blocker_id, blocked_id)
    VALUES (v_uid, p_user_id)
    ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
END $$;


ALTER FUNCTION "public"."block_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."boycott_reports_block_moderation_edits"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_is_admin BOOLEAN := EXISTS (
        SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    );
BEGIN
    IF NOT v_is_admin THEN
        IF NEW.status      IS DISTINCT FROM OLD.status      OR
           NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR
           NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
            RAISE EXCEPTION 'only admins can change moderation fields'
                USING ERRCODE = '42501';
        END IF;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;


ALTER FUNCTION "public"."boycott_reports_block_moderation_edits"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_follow_request"("p_target_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    DELETE FROM follow_requests
    WHERE requester_id = auth.uid() AND target_user_id = p_target_user_id;
  END;
  $$;


ALTER FUNCTION "public"."cancel_follow_request"("p_target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_boycott"("p_name" character varying, "p_description" "text", "p_is_public" boolean, "p_source_links" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_boycott_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_boycott_id := gen_random_uuid();

    INSERT INTO boycotts (id, creator_id, name, description, is_public, source_links, created_at)
    VALUES (v_boycott_id, v_user_id, p_name, p_description, p_is_public, p_source_links, NOW());

    RETURN jsonb_build_object(
        'id', v_boycott_id,
        'name', p_name,
        'description', p_description,
        'is_public', p_is_public,
        'source_links', p_source_links,
        'created_at', NOW()
    );
END;
$$;


ALTER FUNCTION "public"."create_boycott"("p_name" character varying, "p_description" "text", "p_is_public" boolean, "p_source_links" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_boycott_update"("p_boycott_id" "uuid", "p_summary" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_creator_id UUID;
    v_update_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT creator_id INTO v_creator_id FROM boycotts WHERE id = p_boycott_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Boycott not found';
    END IF;

    IF v_creator_id != v_user_id THEN
        RAISE EXCEPTION 'Only the boycott creator can post updates';
    END IF;

    v_update_id := gen_random_uuid();
    INSERT INTO boycott_updates (id, boycott_id, author_id, summary)
    VALUES (v_update_id, p_boycott_id, v_user_id, p_summary);

    RETURN v_update_id;
END;
$$;


ALTER FUNCTION "public"."create_boycott_update"("p_boycott_id" "uuid", "p_summary" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_post"("p_content" "text" DEFAULT NULL::"text", "p_post_type" "text" DEFAULT 'text'::"text", "p_boycott_id" "uuid" DEFAULT NULL::"uuid", "p_original_post_id" "uuid" DEFAULT NULL::"uuid", "p_media_url" "text" DEFAULT NULL::"text", "p_media_type" "text" DEFAULT NULL::"text", "p_link_url" "text" DEFAULT NULL::"text", "p_media_urls" "jsonb" DEFAULT NULL::"jsonb", "p_audience" "text" DEFAULT 'everyone'::"text", "p_company_mentions" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_post_id UUID;
  v_uid UUID := auth.uid();
  v_audience TEXT := COALESCE(p_audience, 'everyone');
  v_mention JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_content IS NOT NULL AND char_length(p_content) > 300 THEN
    RAISE EXCEPTION 'Content exceeds 300 character limit';
  END IF;

  IF p_post_type IN ('boycott_share', 'boycott_repost') AND p_boycott_id IS NULL THEN
    RAISE EXCEPTION 'boycott_id required for boycott posts';
  END IF;

  IF p_post_type = 'boycott_repost' AND p_original_post_id IS NULL THEN
    RAISE EXCEPTION 'original_post_id required for reposts';
  END IF;

  IF v_audience NOT IN ('everyone', 'followers', 'just_me') THEN
    v_audience := 'everyone';
  END IF;

  INSERT INTO posts (
    author_id, post_type, content, boycott_id, original_post_id,
    media_url, media_type, link_url, audience
  )
  VALUES (
    v_uid, p_post_type, p_content, p_boycott_id, p_original_post_id,
    p_media_url, p_media_type, p_link_url, v_audience
  )
  RETURNING id INTO v_post_id;

  IF p_original_post_id IS NOT NULL THEN
    UPDATE posts SET repost_count = repost_count + 1, updated_at = now()
    WHERE id = p_original_post_id;
  END IF;

  -- Persist multi-image array (legacy compat — see prior migration note)
  IF p_media_urls IS NOT NULL AND jsonb_typeof(p_media_urls) = 'array'
     AND jsonb_array_length(p_media_urls) > 0 THEN
    UPDATE posts SET media_url = COALESCE(media_url, p_media_urls->0->>'url')
    WHERE id = v_post_id AND media_url IS NULL;
  END IF;

  -- Insert @company mentions
  IF p_company_mentions IS NOT NULL AND jsonb_typeof(p_company_mentions) = 'array' THEN
    FOR v_mention IN SELECT * FROM jsonb_array_elements(p_company_mentions) LOOP
      IF v_mention->>'id' IS NOT NULL AND v_mention->>'name' IS NOT NULL THEN
        INSERT INTO posts_companies (post_id, company_id, company_name)
        VALUES (v_post_id, v_mention->>'id', v_mention->>'name')
        ON CONFLICT (post_id, company_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_post_id;
END;
$$;


ALTER FUNCTION "public"."create_post"("p_content" "text", "p_post_type" "text", "p_boycott_id" "uuid", "p_original_post_id" "uuid", "p_media_url" "text", "p_media_type" "text", "p_link_url" "text", "p_media_urls" "jsonb", "p_audience" "text", "p_company_mentions" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_reply"("p_post_id" "uuid", "p_content" "text", "p_parent_reply_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_reply_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_content IS NULL OR char_length(trim(p_content)) = 0 THEN
    RAISE EXCEPTION 'Reply content is required';
  END IF;

  IF char_length(p_content) > 2000 THEN
    RAISE EXCEPTION 'Reply exceeds 2000 character limit';
  END IF;

  IF p_parent_reply_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM post_replies WHERE id = p_parent_reply_id AND post_id = p_post_id) THEN
      RAISE EXCEPTION 'Parent reply not found';
    END IF;
  END IF;

  INSERT INTO post_replies (post_id, author_id, content, parent_reply_id)
  VALUES (p_post_id, v_uid, trim(p_content), p_parent_reply_id)
  RETURNING id INTO v_reply_id;

  UPDATE posts SET reply_count = reply_count + 1, updated_at = now()
  WHERE id = p_post_id;

  RETURN v_reply_id;
END;
$$;


ALTER FUNCTION "public"."create_reply"("p_post_id" "uuid", "p_content" "text", "p_parent_reply_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_boycott"("p_boycott_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    DELETE FROM boycotts WHERE id = p_boycott_id AND creator_id = auth.uid();
  END;
  $$;


ALTER FUNCTION "public"."delete_boycott"("p_boycott_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_boycott_comment"("p_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_media_url TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    DELETE FROM boycott_comments
    WHERE id = p_id AND user_id = v_user_id
    RETURNING media_url INTO v_media_url;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Comment not found or not owned';
    END IF;

    RETURN v_media_url;
END;
$$;


ALTER FUNCTION "public"."delete_boycott_comment"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_post"("p_post_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_original_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT original_post_id INTO v_original_id FROM posts WHERE id = p_post_id AND author_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found or not owned by you';
  END IF;

  DELETE FROM posts WHERE id = p_post_id AND author_id = v_uid;

  IF v_original_id IS NOT NULL THEN
    UPDATE posts SET repost_count = GREATEST(repost_count - 1, 0), updated_at = now()
    WHERE id = v_original_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."delete_post"("p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_role_change_is_privileged"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role IS NOT NULL
       AND current_user <> 'service_role'
       AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    THEN
      RAISE EXCEPTION 'Not authorized to set profiles.role';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF current_user <> 'service_role'
       AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    THEN
      RAISE EXCEPTION 'Only an existing admin or the service role may change profiles.role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_role_change_is_privileged"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."follow_user"("p_following_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    INSERT INTO user_follows (follower_id, following_id)
    VALUES (auth.uid(), p_following_id);
  END;
  $$;


ALTER FUNCTION "public"."follow_user"("p_following_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_companies_with_counts"() RETURNS TABLE("id" "uuid", "name" "text", "logo_url" "text", "connection_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
      RETURN QUERY
      SELECT
          c.id,
          c.name::TEXT,
          c.logo_url::TEXT,
          (SELECT COUNT(*)::BIGINT FROM company_connections cc
           WHERE cc.source_company_id = c.id OR cc.target_company_id = c.id) as connection_count
      FROM companies c
      ORDER BY c.name;
  END;
  $$;


ALTER FUNCTION "public"."get_all_companies_with_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_connections"() RETURNS TABLE("id" "uuid", "source_company_id" "uuid", "target_company_id" "uuid", "connection_type" "public"."connection_type", "ownership_percentage" numeric, "source_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        cc.id,
        cc.source_company_id,
        cc.target_company_id,
        cc.connection_type,
        cc.ownership_percentage,
        (SELECT COUNT(*) FROM connection_sources cs WHERE cs.connection_id = cc.id) as source_count
    FROM company_connections cc
    ORDER BY cc.id;
END;
$$;


ALTER FUNCTION "public"."get_all_connections"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_connections_with_details"() RETURNS TABLE("id" "uuid", "source_company_id" "uuid", "source_company_name" "text", "target_company_id" "uuid", "target_company_name" "text", "connection_type" "public"."connection_type", "ownership_percentage" numeric, "source_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        cc.id,
        cc.source_company_id,
        sc.name as source_company_name,
        cc.target_company_id,
        tc.name as target_company_name,
        cc.connection_type,
        cc.ownership_percentage,
        (SELECT COUNT(*) FROM connection_sources cs WHERE cs.connection_id = cc.id) as source_count
    FROM company_connections cc
    JOIN companies sc ON sc.id = cc.source_company_id
    JOIN companies tc ON tc.id = cc.target_company_id
    ORDER BY sc.name, tc.name;
END;
$$;


ALTER FUNCTION "public"."get_all_connections_with_details"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_feedback"() RETURNS TABLE("id" "uuid", "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "submitted_by_name" "text", "title" "text", "description" "text", "category" "text", "priority" "text", "status" "text", "resolution_notes" "text", "resolved_at" timestamp with time zone, "affected_area" "text", "fix_in_progress" boolean, "fix_triggered_at" timestamp with time zone, "comment_count" bigint)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id,
    f.created_at,
    f.updated_at,
    f.submitted_by_name,
    f.title,
    f.description,
    f.category,
    f.priority,
    f.status,
    f.resolution_notes,
    f.resolved_at,
    f.affected_area,
    f.fix_in_progress,
    f.fix_triggered_at,
    COUNT(fc.id) as comment_count
  FROM feedback f
  LEFT JOIN feedback_comments fc ON fc.feedback_id = f.id
  GROUP BY f.id
  ORDER BY
    CASE f.status
      WHEN 'open' THEN 1
      WHEN 'in_progress' THEN 2
      ELSE 3
    END,
    CASE f.priority
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      ELSE 4
    END,
    f.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_all_feedback"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_alternatives_for_company"("p_target_company_id" "text") RETURNS TABLE("id" "uuid", "alternative_company_id" "text", "is_sponsored" boolean, "display_priority" integer, "pitch" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        pa.id,
        pa.alternative_company_id,
        pa.is_sponsored,
        pa.display_priority,
        pa.pitch
    FROM product_alternatives pa
    WHERE pa.target_company_id = p_target_company_id
      AND (pa.sponsor_ends_at IS NULL OR pa.sponsor_ends_at > NOW())
      AND (pa.sponsor_starts_at IS NULL OR pa.sponsor_starts_at <= NOW())
    ORDER BY pa.is_sponsored DESC, pa.display_priority DESC, pa.created_at DESC
    LIMIT 12;
END;
$$;


ALTER FUNCTION "public"."get_alternatives_for_company"("p_target_company_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_blocked_users"() RETURNS TABLE("id" "uuid", "username" character varying, "display_name" "text", "profile_picture_url" "text", "blocked_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
    END IF;

    RETURN QUERY
    SELECT p.id, p.username, p.display_name::text, p.profile_picture_url, ub.created_at
    FROM user_blocks ub
    JOIN profiles p ON p.id = ub.blocked_id
    WHERE ub.blocker_id = v_uid
    ORDER BY ub.created_at DESC;
END $$;


ALTER FUNCTION "public"."get_blocked_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_boycott_comments"("p_boycott_id" "uuid") RETURNS TABLE("id" "uuid", "boycott_id" "uuid", "user_id" "uuid", "content" "text", "label" "text", "media_url" "text", "media_type" "text", "created_at" timestamp with time zone, "username" character varying, "display_name" "text", "profile_picture_url" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM boycotts b
        WHERE b.id = p_boycott_id
          AND (b.is_public = TRUE OR b.creator_id = auth.uid())
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        bc.id,
        bc.boycott_id,
        bc.user_id,
        bc.content,
        bc.label,
        bc.media_url,
        bc.media_type,
        bc.created_at,
        p.username,
        p.display_name,
        p.profile_picture_url
    FROM boycott_comments bc
    JOIN profiles p ON p.id = bc.user_id
    WHERE bc.boycott_id = p_boycott_id
    ORDER BY bc.created_at ASC;
END;
$$;


ALTER FUNCTION "public"."get_boycott_comments"("p_boycott_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_boycott_for_share"("p_id" "uuid") RETURNS TABLE("id" "uuid", "name" character varying, "description" "text", "is_public" boolean, "og_image_url" "text", "company_count" bigint, "tracker_count" bigint)
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
        b.og_image_url,
        (SELECT COUNT(*) FROM boycott_companies bc WHERE bc.boycott_id = b.id) AS company_count,
        (SELECT COUNT(*) FROM adopted_boycotts ab JOIN profiles ap ON ap.id = ab.user_id
            WHERE ab.boycott_id = b.id AND NOT COALESCE(ap.is_test_user, false)) AS tracker_count
    FROM boycotts b
    WHERE b.id = p_id AND b.is_public = true;
END;
$$;


ALTER FUNCTION "public"."get_boycott_for_share"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_boycotts_for_company"("p_company_identifier" "text") RETURNS TABLE("id" "uuid", "name" character varying, "description" "text", "is_public" boolean, "created_at" timestamp with time zone, "creator_id" "uuid", "tracker_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    resolved_id UUID;
BEGIN
    resolved_id := resolve_company_id(p_company_identifier);

    RETURN QUERY
    SELECT
        b.id,
        b.name,
        b.description,
        b.is_public,
        b.created_at,
        b.creator_id,
        (SELECT COUNT(*) FROM adopted_boycotts ab JOIN profiles ap ON ap.id = ab.user_id
            WHERE ab.boycott_id = b.id AND NOT COALESCE(ap.is_test_user, false)) AS tracker_count
    FROM boycotts b
    JOIN boycott_companies bc ON bc.boycott_id = b.id
    LEFT JOIN profiles cp ON cp.id = b.creator_id
    WHERE bc.company_id = resolved_id
      AND b.is_public = true
      AND (
          (NOT COALESCE(b.is_seed, false) AND NOT COALESCE(cp.is_test_user, false))
          OR (SELECT s.enabled FROM app_settings s WHERE s.key = 'show_seed_boycotts')
      )
    ORDER BY tracker_count DESC, b.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_boycotts_for_company"("p_company_identifier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_company"("p_company_id" "text") RETURNS TABLE("id" "uuid", "name" character varying, "description" "text", "website" character varying, "logo_url" character varying, "lei" character varying, "cik" character varying, "wikidata_qid" character varying, "littlesis_id" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    resolved_id UUID;
BEGIN
    resolved_id := resolve_company_id(p_company_id);
    IF resolved_id IS NULL THEN
        RETURN;
    END IF;
    
    RETURN QUERY
    SELECT c.id, c.name, c.description, c.website, c.logo_url, c.lei, c.cik, c.wikidata_qid, c.littlesis_id
    FROM companies c
    WHERE c.id = resolved_id;
END;
$$;


ALTER FUNCTION "public"."get_company"("p_company_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_company_connections_by_type"("p_company_id" "uuid", "p_relationship_type" "text", "p_direction" "text") RETURNS TABLE("id" "uuid", "name" "text", "logo_url" "text")
    LANGUAGE "plpgsql"
    AS $$
  BEGIN
    IF p_direction = 'outgoing' THEN
      RETURN QUERY
      SELECT c.id, c.name::TEXT, c.logo_url::TEXT
      FROM companies c
      JOIN company_connections cc ON cc.target_company_id = c.id
      WHERE cc.source_company_id = p_company_id
        AND cc.connection_type::TEXT = p_relationship_type;
    ELSE
      RETURN QUERY
      SELECT c.id, c.name::TEXT, c.logo_url::TEXT
      FROM companies c
      JOIN company_connections cc ON cc.source_company_id = c.id
      WHERE cc.target_company_id = p_company_id
        AND cc.connection_type::TEXT = p_relationship_type;
    END IF;
  END;
  $$;


ALTER FUNCTION "public"."get_company_connections_by_type"("p_company_id" "uuid", "p_relationship_type" "text", "p_direction" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_company_incoming_connections"("p_company_id" "text") RETURNS TABLE("connection_id" "uuid", "source_id" "uuid", "source_name" character varying, "source_logo_url" character varying, "connection_type" "public"."connection_type", "data_source" character varying, "ownership_percentage" numeric, "source_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    resolved_id UUID;
BEGIN
    resolved_id := resolve_company_id(p_company_id);
    IF resolved_id IS NULL THEN
        RETURN;
    END IF;
    
    RETURN QUERY
    SELECT 
        cc.id as connection_id,
        cc.source_company_id as source_id,
        c.name as source_name,
        c.logo_url as source_logo_url,
        cc.connection_type,
        cc.data_source,
        cc.ownership_percentage,
        (SELECT COUNT(*) FROM connection_sources cs WHERE cs.connection_id = cc.id) as source_count
    FROM company_connections cc
    JOIN companies c ON c.id = cc.source_company_id
    WHERE cc.target_company_id = resolved_id
    ORDER BY c.name;
END;
$$;


ALTER FUNCTION "public"."get_company_incoming_connections"("p_company_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_company_outgoing_connections"("p_company_id" "text") RETURNS TABLE("connection_id" "uuid", "target_id" "uuid", "target_name" character varying, "target_logo_url" character varying, "connection_type" "public"."connection_type", "data_source" character varying, "ownership_percentage" numeric, "source_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    resolved_id UUID;
BEGIN
    resolved_id := resolve_company_id(p_company_id);
    IF resolved_id IS NULL THEN
        RETURN;
    END IF;
    
    RETURN QUERY
    SELECT 
        cc.id as connection_id,
        cc.target_company_id as target_id,
        c.name as target_name,
        c.logo_url as target_logo_url,
        cc.connection_type,
        cc.data_source,
        cc.ownership_percentage,
        (SELECT COUNT(*) FROM connection_sources cs WHERE cs.connection_id = cc.id) as source_count
    FROM company_connections cc
    JOIN companies c ON c.id = cc.target_company_id
    WHERE cc.source_company_id = resolved_id
    ORDER BY c.name;
END;
$$;


ALTER FUNCTION "public"."get_company_outgoing_connections"("p_company_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_connection_source_count"("p_connection_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  DECLARE
    count_val integer;
  BEGIN
    SELECT COUNT(*) INTO count_val
    FROM connection_sources
    WHERE connection_id = p_connection_id;
    RETURN count_val;
  END;
  $$;


ALTER FUNCTION "public"."get_connection_source_count"("p_connection_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_connection_sources"("p_connection_id" "uuid") RETURNS TABLE("id" "uuid", "source_url" "text", "source_title" "text", "source_type" character varying, "source_date" "date")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
      RETURN QUERY
      SELECT
          cs.id,
          cs.source_url::TEXT,
          cs.source_title::TEXT,
          cs.source_type::VARCHAR(50),
          cs.source_date
      FROM connection_sources cs
      WHERE cs.connection_id = p_connection_id
      ORDER BY cs.source_date DESC NULLS LAST, cs.created_at DESC;
  END;
  $$;


ALTER FUNCTION "public"."get_connection_sources"("p_connection_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_conversations"() RETURNS TABLE("conversation_id" "uuid", "other_user_id" "uuid", "other_username" character varying, "other_display_name" "text", "other_profile_picture_url" "text", "last_message_content" "text", "last_message_at" timestamp with time zone, "last_message_sender_id" "uuid", "unread_count" bigint, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    RETURN QUERY
    SELECT
        c.id AS conversation_id,
        p.id AS other_user_id,
        p.username AS other_username,
        p.display_name AS other_display_name,
        p.profile_picture_url AS other_profile_picture_url,
        last_msg.content AS last_message_content,
        last_msg.created_at AS last_message_at,
        last_msg.sender_id AS last_message_sender_id,
        COUNT(unread.id) AS unread_count,
        c.updated_at
    FROM conversation_participants my_cp
    JOIN conversations c ON c.id = my_cp.conversation_id
    JOIN conversation_participants other_cp
        ON other_cp.conversation_id = c.id AND other_cp.user_id != v_user_id
    JOIN profiles p ON p.id = other_cp.user_id
    LEFT JOIN LATERAL (
        SELECT m.content, m.created_at, m.sender_id
        FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1
    ) last_msg ON TRUE
    LEFT JOIN messages unread
        ON unread.conversation_id = c.id
        AND unread.sender_id != v_user_id
        AND unread.read_at IS NULL
    WHERE my_cp.user_id = v_user_id
    GROUP BY c.id, p.id, p.username, p.display_name, p.profile_picture_url,
             last_msg.content, last_msg.created_at, last_msg.sender_id, c.updated_at
    ORDER BY COALESCE(last_msg.created_at, c.created_at) DESC;
END;
$$;


ALTER FUNCTION "public"."get_conversations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_email_by_username"("p_username" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_email text;
BEGIN
    SELECT au.email INTO v_email
    FROM profiles p
    JOIN auth.users au ON au.id = p.id
    WHERE lower(p.username) = lower(p_username)
    LIMIT 1;

    RETURN v_email;
END;
$$;


ALTER FUNCTION "public"."get_email_by_username"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_feed"("p_cursor" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_limit" integer DEFAULT 20) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSON;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_limit < 1 THEN p_limit := 1; END IF;
  IF p_limit > 50 THEN p_limit := 50; END IF;

  SELECT json_agg(row_to_json(t))
  INTO v_result
  FROM (
    SELECT
      p.id,
      p.author_id,
      p.post_type,
      p.content,
      p.boycott_id,
      p.original_post_id,
      p.media_url,
      p.media_type,
      p.link_url,
      p.like_count,
      p.reply_count,
      p.repost_count,
      p.created_at,
      p.audience,
      json_build_object(
        'id', pr.id,
        'username', pr.username,
        'display_name', pr.display_name,
        'profile_picture_url', pr.profile_picture_url
      ) AS author,
      CASE WHEN p.boycott_id IS NOT NULL THEN
        (SELECT json_build_object(
          'id', b.id,
          'name', b.name,
          'description', b.description,
          'is_public', b.is_public,
          'creator_id', b.creator_id,
          'company_count', (SELECT count(*) FROM boycott_companies bc WHERE bc.boycott_id = b.id),
          'tracker_count', (SELECT count(*) FROM adopted_boycotts ab WHERE ab.boycott_id = b.id)
        ) FROM boycotts b WHERE b.id = p.boycott_id)
      ELSE NULL END AS boycott,
      EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = v_uid) AS liked_by_me,
      EXISTS(
        SELECT 1 FROM post_reposts rp
        WHERE rp.user_id = v_uid AND rp.post_id = COALESCE(p.original_post_id, p.id)
      ) AS reposted_by_me,
      CASE WHEN p.post_type = 'repost' AND p.original_post_id IS NOT NULL THEN
        (SELECT json_build_object(
          'id', op.id,
          'author_id', op.author_id,
          'post_type', op.post_type,
          'content', op.content,
          'media_url', op.media_url,
          'media_type', op.media_type,
          'link_url', op.link_url,
          'like_count', op.like_count,
          'reply_count', op.reply_count,
          'repost_count', op.repost_count,
          'created_at', op.created_at,
          'boycott_id', op.boycott_id,
          'audience', op.audience,
          'author', json_build_object(
            'id', opr.id,
            'username', opr.username,
            'display_name', opr.display_name,
            'profile_picture_url', opr.profile_picture_url
          )
        ) FROM posts op
        JOIN profiles opr ON opr.id = op.author_id
        WHERE op.id = p.original_post_id)
      ELSE NULL END AS original_post,
      CASE WHEN p.link_url IS NOT NULL THEN
        (SELECT json_build_object(
          'url', lp.url,
          'title', lp.title,
          'description', lp.description,
          'image_url', lp.image_url,
          'site_name', lp.site_name
        ) FROM link_previews lp WHERE lp.url = p.link_url)
      ELSE NULL END AS link_preview
    FROM posts p
    JOIN profiles pr ON pr.id = p.author_id
    WHERE (
      p.author_id = v_uid
      OR p.author_id IN (SELECT following_id FROM user_follows WHERE follower_id = v_uid)
    )
    -- Audience filter: viewer can see post only if visibility allows
    AND (
      p.audience = 'everyone'
      OR p.author_id = v_uid
      OR (
        p.audience = 'followers'
        AND EXISTS (
          SELECT 1 FROM user_follows
          WHERE follower_id = v_uid AND following_id = p.author_id
        )
      )
    )
    -- Hide the user's own boycott activity posts from their feed (legacy)
    AND NOT (
      p.author_id = v_uid
      AND p.post_type IN ('boycott_published', 'boycott_updated', 'boycott_made_public')
    )
    -- Block filter: hide posts authored by anyone the viewer has blocked or
    -- who has blocked the viewer
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE (ub.blocker_id = v_uid AND ub.blocked_id = p.author_id)
         OR (ub.blocker_id = p.author_id AND ub.blocked_id = v_uid)
    )
    -- Block filter: hide reposts whose ORIGINAL author falls in either set
    AND NOT EXISTS (
      SELECT 1
      FROM posts orig
      JOIN user_blocks ub2
        ON (ub2.blocker_id = v_uid AND ub2.blocked_id = orig.author_id)
        OR (ub2.blocker_id = orig.author_id AND ub2.blocked_id = v_uid)
      WHERE orig.id = p.original_post_id
    )
    AND (p_cursor IS NULL OR p.created_at < p_cursor)
    ORDER BY p.created_at DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;


ALTER FUNCTION "public"."get_feed"("p_cursor" timestamp with time zone, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_feed_unread_count"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_last_read TIMESTAMPTZ;
  v_count INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  SELECT feed_last_read INTO v_last_read
  FROM profiles WHERE id = v_uid;

  IF v_last_read IS NULL THEN
    v_last_read := now() - interval '24 hours';
  END IF;

  SELECT COUNT(*)::INT INTO v_count
  FROM posts p
  WHERE p.author_id IN (SELECT following_id FROM user_follows WHERE follower_id = v_uid)
    AND p.author_id != v_uid
    AND p.created_at > v_last_read;

  IF v_count > 100 THEN
    v_count := 100;
  END IF;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."get_feed_unread_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_followed_boycotts"("p_user_id" "uuid") RETURNS TABLE("id" "uuid", "name" character varying, "description" "text", "is_public" boolean, "created_at" timestamp with time zone, "creator_id" "uuid", "adopted_at" timestamp with time zone, "boycott_companies" "jsonb")
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
        ab.adopted_at,
        COALESCE(
            jsonb_agg(
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
            ) FILTER (WHERE bc.id IS NOT NULL),
            '[]'::jsonb
        ) as boycott_companies
    FROM adopted_boycotts ab
    JOIN boycotts b ON b.id = ab.boycott_id
    LEFT JOIN boycott_companies bc ON bc.boycott_id = b.id
    LEFT JOIN companies c ON c.id = bc.company_id
    WHERE ab.user_id = p_user_id
      -- Viewing someone else's adopted list shows only public boycotts; your own shows all.
      AND (b.is_public = true OR p_user_id = auth.uid() OR b.creator_id = auth.uid())
    GROUP BY b.id, b.name, b.description, b.is_public, b.created_at, b.creator_id, ab.adopted_at
    ORDER BY ab.adopted_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_followed_boycotts"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_follower_count"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    RETURN (SELECT COUNT(*) FROM user_follows WHERE following_id = p_user_id)::int;
  END;
  $$;


ALTER FUNCTION "public"."get_follower_count"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_followers"("p_user_id" "uuid") RETURNS TABLE("id" "uuid", "username" character varying, "display_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    RETURN QUERY
    SELECT profiles.id, profiles.username, profiles.display_name
    FROM user_follows
    JOIN profiles ON profiles.id = user_follows.follower_id
    WHERE user_follows.following_id = p_user_id;
  END;
  $$;


ALTER FUNCTION "public"."get_followers"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_following"("p_user_id" "uuid") RETURNS TABLE("id" "uuid", "username" character varying)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    RETURN QUERY
    SELECT profiles.id, profiles.username
    FROM user_follows
    JOIN profiles ON profiles.id = user_follows.following_id
    WHERE user_follows.follower_id = p_user_id;
  END;
  $$;


ALTER FUNCTION "public"."get_following"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_following_count"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    RETURN (SELECT COUNT(*) FROM user_follows WHERE follower_id = p_user_id)::int;
  END;
  $$;


ALTER FUNCTION "public"."get_following_count"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_following_with_profiles"("p_user_id" "uuid") RETURNS TABLE("id" "uuid", "username" character varying, "display_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    RETURN QUERY
    SELECT profiles.id, profiles.username, profiles.display_name
    FROM user_follows
    JOIN profiles ON profiles.id = user_follows.following_id
    WHERE user_follows.follower_id = p_user_id;
  END;
  $$;


ALTER FUNCTION "public"."get_following_with_profiles"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_incoming_follow_requests"("p_user_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    RETURN COALESCE((
      SELECT json_agg(row_to_json(result))
      FROM (
        SELECT
          follow_requests.*,
          row_to_json(profiles) as requester
        FROM follow_requests
        JOIN profiles ON profiles.id = follow_requests.requester_id
        WHERE follow_requests.target_user_id = p_user_id
          AND follow_requests.status = 'pending'
      ) result
    ), '[]'::json);
  END;
  $$;


ALTER FUNCTION "public"."get_incoming_follow_requests"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_messages"("p_conversation_id" "uuid", "p_limit" integer DEFAULT 50) RETURNS TABLE("id" "uuid", "conversation_id" "uuid", "sender_id" "uuid", "content" "text", "created_at" timestamp with time zone, "read_at" timestamp with time zone, "sender_username" character varying, "sender_display_name" "text", "sender_profile_picture_url" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM conversation_participants cp
        WHERE cp.conversation_id = p_conversation_id AND cp.user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    UPDATE messages
    SET read_at = NOW()
    WHERE messages.conversation_id = p_conversation_id
      AND messages.sender_id != v_user_id
      AND messages.read_at IS NULL;

    RETURN QUERY
    SELECT
        m.id,
        m.conversation_id,
        m.sender_id,
        m.content,
        m.created_at,
        m.read_at,
        p.username AS sender_username,
        p.display_name AS sender_display_name,
        p.profile_picture_url AS sender_profile_picture_url
    FROM messages m
    JOIN profiles p ON p.id = m.sender_id
    WHERE m.conversation_id = p_conversation_id
    ORDER BY m.created_at DESC
    LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."get_messages"("p_conversation_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_boycotts"("p_user_id" "uuid") RETURNS TABLE("id" "uuid", "name" character varying, "description" "text", "is_public" boolean, "created_at" timestamp with time zone, "creator_id" "uuid", "boycott_companies" "jsonb")
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
        COALESCE(
            jsonb_agg(
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
            ) FILTER (WHERE bc.id IS NOT NULL),
            '[]'::jsonb
        ) as boycott_companies
    FROM boycotts b
    LEFT JOIN boycott_companies bc ON bc.boycott_id = b.id
    LEFT JOIN companies c ON c.id = bc.company_id
    WHERE b.creator_id = p_user_id
      -- Only the owner sees their private boycotts.
      AND (b.is_public = true OR p_user_id = auth.uid())
    GROUP BY b.id, b.name, b.description, b.is_public, b.created_at, b.creator_id
    ORDER BY b.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_my_boycotts"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_followed_updates"("p_cursor" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_limit" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "boycott_id" "uuid", "author_id" "uuid", "summary" "text", "created_at" timestamp with time zone, "username" character varying, "display_name" "text", "profile_picture_url" "text", "boycott_name" "text", "boycott_is_public" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_limit < 1 THEN p_limit := 1; END IF;
    IF p_limit > 50 THEN p_limit := 50; END IF;

    RETURN QUERY
    SELECT
        bu.id,
        bu.boycott_id,
        bu.author_id,
        bu.summary,
        bu.created_at,
        p.username,
        p.display_name,
        p.profile_picture_url,
        b.name::text AS boycott_name,
        b.is_public AS boycott_is_public
    FROM boycott_updates bu
    JOIN boycotts b ON b.id = bu.boycott_id
    JOIN profiles p ON p.id = bu.author_id
    WHERE bu.author_id != v_user_id
      AND bu.boycott_id IN (
          SELECT ab.boycott_id FROM adopted_boycotts ab WHERE ab.user_id = v_user_id
      )
      AND (p_cursor IS NULL OR bu.created_at < p_cursor)
    ORDER BY bu.created_at DESC
    LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."get_my_followed_updates"("p_cursor" timestamp with time zone, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_or_create_conversation"("p_other_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_conversation_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF v_user_id = p_other_user_id THEN
        RAISE EXCEPTION 'Cannot start conversation with yourself';
    END IF;

    -- Find existing conversation with exactly these two participants
    SELECT cp1.conversation_id INTO v_conversation_id
    FROM conversation_participants cp1
    JOIN conversation_participants cp2
        ON cp1.conversation_id = cp2.conversation_id
        AND cp2.user_id = p_other_user_id
    WHERE cp1.user_id = v_user_id
    LIMIT 1;

    IF v_conversation_id IS NOT NULL THEN
        RETURN v_conversation_id;
    END IF;

    -- Create new conversation
    INSERT INTO conversations DEFAULT VALUES RETURNING id INTO v_conversation_id;

    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_conversation_id, v_user_id), (v_conversation_id, p_other_user_id);

    RETURN v_conversation_id;
END;
$$;


ALTER FUNCTION "public"."get_or_create_conversation"("p_other_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_outgoing_follow_requests"("p_user_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    RETURN (
      SELECT json_agg(row_to_json(result))
      FROM (
        SELECT
          follow_requests.*,
          row_to_json(profiles) as target
        FROM follow_requests
        JOIN profiles ON profiles.id = follow_requests.target_user_id
        WHERE follow_requests.requester_id = p_user_id
          AND follow_requests.status = 'pending'
      ) result
    );
  END;
  $$;


ALTER FUNCTION "public"."get_outgoing_follow_requests"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_post"("p_post_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSON;
BEGIN
  SELECT row_to_json(t)
  INTO v_result
  FROM (
    SELECT
      p.id,
      p.author_id,
      p.post_type,
      p.content,
      p.boycott_id,
      p.original_post_id,
      p.media_url,
      p.media_type,
      p.link_url,
      p.like_count,
      p.reply_count,
      p.repost_count,
      p.created_at,
      json_build_object(
        'id', pr.id,
        'username', pr.username,
        'display_name', pr.display_name,
        'profile_picture_url', pr.profile_picture_url
      ) AS author,
      (SELECT json_agg(json_build_object(
        'media_url', pm.media_url,
        'media_type', pm.media_type,
        'sort_order', pm.sort_order
      ) ORDER BY pm.sort_order) FROM post_media pm WHERE pm.post_id = p.id) AS media,
      CASE WHEN p.boycott_id IS NOT NULL THEN
        (SELECT json_build_object(
          'id', b.id,
          'name', b.name,
          'description', b.description,
          'is_public', b.is_public,
          'creator_id', b.creator_id,
          'company_count', (SELECT count(*) FROM boycott_companies bc WHERE bc.boycott_id = b.id),
          'tracker_count', (SELECT count(*) FROM adopted_boycotts ab WHERE ab.boycott_id = b.id)
        ) FROM boycotts b WHERE b.id = p.boycott_id)
      ELSE NULL END AS boycott,
      CASE WHEN v_uid IS NOT NULL THEN
        EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = v_uid)
      ELSE false END AS liked_by_me,
      CASE WHEN v_uid IS NOT NULL THEN
        EXISTS(
          SELECT 1 FROM post_reposts rp
          WHERE rp.user_id = v_uid AND rp.post_id = COALESCE(p.original_post_id, p.id)
        )
      ELSE false END AS reposted_by_me,
      CASE WHEN p.post_type = 'repost' AND p.original_post_id IS NOT NULL THEN
        (SELECT json_build_object(
          'id', op.id,
          'author_id', op.author_id,
          'post_type', op.post_type,
          'content', op.content,
          'media_url', op.media_url,
          'media_type', op.media_type,
          'link_url', op.link_url,
          'like_count', op.like_count,
          'reply_count', op.reply_count,
          'repost_count', op.repost_count,
          'created_at', op.created_at,
          'boycott_id', op.boycott_id,
          'media', (SELECT json_agg(json_build_object(
            'media_url', opm.media_url,
            'media_type', opm.media_type,
            'sort_order', opm.sort_order
          ) ORDER BY opm.sort_order) FROM post_media opm WHERE opm.post_id = op.id),
          'author', json_build_object(
            'id', opr.id,
            'username', opr.username,
            'display_name', opr.display_name,
            'profile_picture_url', opr.profile_picture_url
          ),
          'boycott', CASE WHEN op.boycott_id IS NOT NULL THEN
            (SELECT json_build_object(
              'id', ob.id,
              'name', ob.name,
              'description', ob.description,
              'is_public', ob.is_public,
              'creator_id', ob.creator_id,
              'company_count', (SELECT count(*) FROM boycott_companies obc WHERE obc.boycott_id = ob.id),
              'tracker_count', (SELECT count(*) FROM adopted_boycotts oab WHERE oab.boycott_id = ob.id)
            ) FROM boycotts ob WHERE ob.id = op.boycott_id)
          ELSE NULL END,
          'link_preview', CASE WHEN op.link_url IS NOT NULL THEN
            (SELECT json_build_object(
              'url', olp.url,
              'title', olp.title,
              'description', olp.description,
              'image_url', olp.image_url,
              'site_name', olp.site_name
            ) FROM link_previews olp WHERE olp.url = op.link_url)
          ELSE NULL END
        ) FROM posts op
        JOIN profiles opr ON opr.id = op.author_id
        WHERE op.id = p.original_post_id)
      ELSE NULL END AS original_post,
      CASE WHEN p.link_url IS NOT NULL THEN
        (SELECT json_build_object(
          'url', lp.url,
          'title', lp.title,
          'description', lp.description,
          'image_url', lp.image_url,
          'site_name', lp.site_name
        ) FROM link_previews lp WHERE lp.url = p.link_url)
      ELSE NULL END AS link_preview
    FROM posts p
    JOIN profiles pr ON pr.id = p.author_id
    WHERE p.id = p_post_id
  ) t;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_post"("p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_post_for_share"("p_id" "uuid") RETURNS TABLE("id" "uuid", "content" "text", "media_url" "text", "author_display_name" "text", "author_username" "text", "author_profile_picture_url" "text", "boycott_name" character varying, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.content,
        p.media_url,
        pr.display_name AS author_display_name,
        pr.username AS author_username,
        pr.profile_picture_url AS author_profile_picture_url,
        b.name AS boycott_name,
        p.created_at
    FROM posts p
    LEFT JOIN profiles pr ON pr.id = p.author_id
    LEFT JOIN boycotts b ON b.id = p.boycott_id
    WHERE p.id = p_id AND p.audience = 'everyone';
END;
$$;


ALTER FUNCTION "public"."get_post_for_share"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_post_replies"("p_post_id" "uuid", "p_limit" integer DEFAULT 200) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSON;
BEGIN
  IF p_limit < 1 THEN p_limit := 1; END IF;
  IF p_limit > 500 THEN p_limit := 500; END IF;

  SELECT json_agg(row_to_json(t))
  INTO v_result
  FROM (
    SELECT
      r.id,
      r.post_id,
      r.author_id,
      r.content,
      r.parent_reply_id,
      r.created_at,
      json_build_object(
        'id', pr.id,
        'username', pr.username,
        'display_name', pr.display_name,
        'profile_picture_url', pr.profile_picture_url
      ) AS author
    FROM post_replies r
    JOIN profiles pr ON pr.id = r.author_id
    WHERE r.post_id = p_post_id
    -- Block filter: hide replies authored by anyone the viewer has blocked or
    -- who has blocked the viewer
    AND (
      v_uid IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE (ub.blocker_id = v_uid AND ub.blocked_id = r.author_id)
           OR (ub.blocker_id = r.author_id AND ub.blocked_id = v_uid)
      )
    )
    ORDER BY r.created_at ASC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;


ALTER FUNCTION "public"."get_post_replies"("p_post_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_profile"("p_user_id" "uuid") RETURNS TABLE("id" "uuid", "username" character varying, "display_name" "text", "bio" "text", "is_private" boolean, "profile_picture_url" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    RETURN QUERY
    SELECT profiles.id, profiles.username, profiles.display_name, profiles.bio,
           profiles.is_private, profiles.profile_picture_url, profiles.created_at
    FROM profiles
    WHERE profiles.id = p_user_id
      AND (
          NOT COALESCE(profiles.is_test_user, false)
          OR profiles.id = auth.uid()
          OR (SELECT s.enabled FROM app_settings s WHERE s.key = 'show_seed_boycotts')
      );
END;
$$;


ALTER FUNCTION "public"."get_profile"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_profiles_by_ids"("p_ids" "uuid"[]) RETURNS TABLE("id" "uuid", "username" character varying, "display_name" "text", "profile_picture_url" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    RETURN QUERY
    SELECT profiles.id, profiles.username, profiles.display_name, profiles.profile_picture_url
    FROM profiles
    WHERE profiles.id = ANY(p_ids);
  END;
  $$;


ALTER FUNCTION "public"."get_profiles_by_ids"("p_ids" "uuid"[]) OWNER TO "postgres";


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
    ORDER BY
        (SELECT COUNT(*) FROM adopted_boycotts ab JOIN profiles ap ON ap.id = ab.user_id
            WHERE ab.boycott_id = b.id AND NOT COALESCE(ap.is_test_user, false)) DESC,
        b.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_public_boycotts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_spending_by_company"("p_user_id" "uuid", "p_start_date" "date" DEFAULT NULL::"date", "p_end_date" "date" DEFAULT NULL::"date") RETURNS TABLE("company_id" "uuid", "company_name" "text", "company_logo_url" "text", "transaction_count" bigint, "total_spent" numeric, "is_boycotted" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access other users data';
  END IF;

  RETURN QUERY
  SELECT
    c.id as company_id,
    c.name as company_name,
    c.logo_url as company_logo_url,
    COUNT(*)::BIGINT as transaction_count,
    SUM(pt.amount)::DECIMAL(12, 2) as total_spent,
    bool_or(pt.is_boycotted) as is_boycotted
  FROM plaid_transactions pt
  JOIN companies c ON c.id = pt.matched_company_id
  WHERE pt.user_id = p_user_id
    AND pt.matched_company_id IS NOT NULL
    AND (p_start_date IS NULL OR pt.date >= p_start_date)
    AND (p_end_date IS NULL OR pt.date <= p_end_date)
  GROUP BY c.id, c.name, c.logo_url
  ORDER BY total_spent DESC;
END;
$$;


ALTER FUNCTION "public"."get_spending_by_company"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_spending_over_time"("p_user_id" "uuid", "p_start_date" "date" DEFAULT NULL::"date", "p_end_date" "date" DEFAULT NULL::"date", "p_group_by" "text" DEFAULT 'day'::"text") RETURNS TABLE("period" "date", "total_spent" numeric, "boycotted_spent" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access other users data';
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN p_group_by = 'week' THEN date_trunc('week', date)::DATE
      WHEN p_group_by = 'month' THEN date_trunc('month', date)::DATE
      ELSE date
    END as period,
    SUM(amount)::DECIMAL(12, 2) as total_spent,
    COALESCE(SUM(amount) FILTER (WHERE is_boycotted = TRUE), 0)::DECIMAL(12, 2) as boycotted_spent
  FROM plaid_transactions
  WHERE user_id = p_user_id
    AND (p_start_date IS NULL OR date >= p_start_date)
    AND (p_end_date IS NULL OR date <= p_end_date)
  GROUP BY 1
  ORDER BY 1;
END;
$$;


ALTER FUNCTION "public"."get_spending_over_time"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_group_by" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_spending_stats"("p_user_id" "uuid", "p_start_date" "date" DEFAULT NULL::"date", "p_end_date" "date" DEFAULT NULL::"date") RETURNS TABLE("total_transactions" bigint, "total_spent" numeric, "boycotted_transactions" bigint, "boycotted_spent" numeric, "matched_transactions" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access other users data';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_transactions,
    COALESCE(SUM(amount), 0)::DECIMAL(12, 2) as total_spent,
    COUNT(*) FILTER (WHERE is_boycotted = TRUE)::BIGINT as boycotted_transactions,
    COALESCE(SUM(amount) FILTER (WHERE is_boycotted = TRUE), 0)::DECIMAL(12, 2) as boycotted_spent,
    COUNT(*) FILTER (WHERE matched_company_id IS NOT NULL)::BIGINT as matched_transactions
  FROM plaid_transactions
  WHERE user_id = p_user_id
    AND (p_start_date IS NULL OR date >= p_start_date)
    AND (p_end_date IS NULL OR date <= p_end_date);
END;
$$;


ALTER FUNCTION "public"."get_spending_stats"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_boycotted_companies"("p_user_id" "uuid") RETURNS TABLE("company_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access other users data';
  END IF;

  RETURN QUERY
  SELECT DISTINCT bc.company_id
  FROM boycotts b
  JOIN boycott_companies bc ON bc.boycott_id = b.id
  WHERE b.creator_id = p_user_id
  UNION
  SELECT DISTINCT bc.company_id
  FROM user_follows uf
  JOIN boycotts b ON b.creator_id = uf.following_id
  JOIN boycott_companies bc ON bc.boycott_id = b.id
  WHERE uf.follower_id = p_user_id
    AND uf.status = 'accepted';
END;
$$;


ALTER FUNCTION "public"."get_user_boycotted_companies"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_boycotts_for_company"("p_company_identifier" "text", "p_user_id" "uuid") RETURNS TABLE("id" "uuid", "name" character varying, "description" "text", "is_public" boolean, "created_at" timestamp with time zone, "creator_id" "uuid", "is_adopted" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    resolved_id UUID;
BEGIN
    resolved_id := resolve_company_id(p_company_identifier);

    RETURN QUERY
    SELECT
        b.id,
        b.name,
        b.description,
        b.is_public,
        b.created_at,
        b.creator_id,
        EXISTS(SELECT 1 FROM adopted_boycotts ab WHERE ab.boycott_id = b.id AND ab.user_id = p_user_id) as is_adopted
    FROM boycotts b
    JOIN boycott_companies bc ON bc.boycott_id = b.id
    LEFT JOIN profiles cp ON cp.id = b.creator_id
    WHERE bc.company_id = resolved_id
      AND (
          b.creator_id = p_user_id
          OR (
              b.is_public = true
              AND (
                  (NOT COALESCE(b.is_seed, false) AND NOT COALESCE(cp.is_test_user, false))
                  OR (SELECT s.enabled FROM app_settings s WHERE s.key = 'show_seed_boycotts')
              )
          )
      )
    ORDER BY b.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_user_boycotts_for_company"("p_company_identifier" "text", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_plaid_items"("p_user_id" "uuid") RETURNS TABLE("id" "uuid", "item_id" "text", "institution_name" "text", "created_at" timestamp with time zone, "last_synced_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access other users data';
  END IF;

  RETURN QUERY
  SELECT
    pi.id,
    pi.item_id,
    pi.institution_name,
    pi.created_at,
    pi.last_synced_at
  FROM plaid_items pi
  WHERE pi.user_id = p_user_id
  ORDER BY pi.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_user_plaid_items"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_posts"("p_user_id" "uuid", "p_cursor" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_limit" integer DEFAULT 20) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSON;
BEGIN
  IF p_limit < 1 THEN p_limit := 1; END IF;
  IF p_limit > 50 THEN p_limit := 50; END IF;

  -- Fake accounts' timelines are hidden from everyone but themselves.
  IF p_user_id <> COALESCE(v_uid, '00000000-0000-0000-0000-000000000000'::uuid)
     AND EXISTS (SELECT 1 FROM profiles tp WHERE tp.id = p_user_id AND COALESCE(tp.is_test_user, false))
     AND NOT (SELECT s.enabled FROM app_settings s WHERE s.key = 'show_seed_boycotts')
  THEN
    RETURN '[]'::json;
  END IF;

  SELECT json_agg(row_to_json(t))
  INTO v_result
  FROM (
    SELECT
      p.id,
      p.author_id,
      p.post_type,
      p.content,
      p.boycott_id,
      p.original_post_id,
      p.media_url,
      p.media_type,
      p.link_url,
      p.like_count,
      p.reply_count,
      p.repost_count,
      p.created_at,
      p.audience,
      json_build_object(
        'id', pr.id,
        'username', pr.username,
        'display_name', pr.display_name,
        'profile_picture_url', pr.profile_picture_url
      ) AS author,
      CASE WHEN p.boycott_id IS NOT NULL THEN
        (SELECT json_build_object(
          'id', b.id,
          'name', b.name,
          'description', b.description,
          'is_public', b.is_public,
          'creator_id', b.creator_id,
          'company_count', (SELECT count(*) FROM boycott_companies bc WHERE bc.boycott_id = b.id),
          'tracker_count', (SELECT count(*) FROM adopted_boycotts ab JOIN profiles ap ON ap.id = ab.user_id WHERE ab.boycott_id = b.id AND NOT COALESCE(ap.is_test_user, false))
        ) FROM boycotts b WHERE b.id = p.boycott_id)
      ELSE NULL END AS boycott,
      CASE WHEN v_uid IS NOT NULL THEN
        EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = v_uid)
      ELSE false END AS liked_by_me,
      CASE WHEN v_uid IS NOT NULL THEN
        EXISTS(
          SELECT 1 FROM post_reposts rp
          WHERE rp.user_id = v_uid AND rp.post_id = COALESCE(p.original_post_id, p.id)
        )
      ELSE false END AS reposted_by_me,
      CASE WHEN p.link_url IS NOT NULL THEN
        (SELECT json_build_object(
          'url', lp.url,
          'title', lp.title,
          'description', lp.description,
          'image_url', lp.image_url,
          'site_name', lp.site_name
        ) FROM link_previews lp WHERE lp.url = p.link_url)
      ELSE NULL END AS link_preview
    FROM posts p
    JOIN profiles pr ON pr.id = p.author_id
    WHERE p.author_id = p_user_id
    AND (
      p.audience = 'everyone'
      OR p.author_id = v_uid
      OR (
        p.audience = 'followers'
        AND v_uid IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM user_follows
          WHERE follower_id = v_uid AND following_id = p.author_id
        )
      )
    )
    AND (p_cursor IS NULL OR p.created_at < p_cursor)
    ORDER BY p.created_at DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;


ALTER FUNCTION "public"."get_user_posts"("p_user_id" "uuid", "p_cursor" timestamp with time zone, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_transactions"("p_user_id" "uuid", "p_start_date" "date" DEFAULT NULL::"date", "p_end_date" "date" DEFAULT NULL::"date", "p_limit" integer DEFAULT 100, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" "uuid", "transaction_id" "text", "amount" numeric, "merchant_name" "text", "date" "date", "category" "text"[], "matched_company_id" "uuid", "match_confidence" numeric, "is_boycotted" boolean, "company_name" "text", "company_logo_url" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access other users data';
  END IF;

  RETURN QUERY
  SELECT
    pt.id,
    pt.transaction_id,
    pt.amount,
    pt.merchant_name,
    pt.date,
    pt.category,
    pt.matched_company_id,
    pt.match_confidence,
    pt.is_boycotted,
    c.name as company_name,
    c.logo_url as company_logo_url
  FROM plaid_transactions pt
  LEFT JOIN companies c ON c.id = pt.matched_company_id
  WHERE pt.user_id = p_user_id
    AND (p_start_date IS NULL OR pt.date >= p_start_date)
    AND (p_end_date IS NULL OR pt.date <= p_end_date)
  ORDER BY pt.date DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."get_user_transactions"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_users_by_followers"("p_limit" integer DEFAULT 50) RETURNS TABLE("id" "uuid", "username" "text", "display_name" "text", "bio" "text", "profile_picture_url" "text", "follower_count" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
    SELECT
      p.id,
      p.username::TEXT,
      p.display_name::TEXT,
      p.bio::TEXT,
      p.profile_picture_url::TEXT,
      COALESCE(f.cnt, 0)::BIGINT as follower_count
    FROM profiles p
    LEFT JOIN (
      SELECT uf.following_id, COUNT(*)::BIGINT as cnt
      FROM user_follows uf
      JOIN profiles fp ON fp.id = uf.follower_id
      WHERE NOT COALESCE(fp.is_test_user, false)   -- fake follows never inflate ranking
      GROUP BY uf.following_id
    ) f ON f.following_id = p.id
    WHERE (p.is_private = false OR p.is_private IS NULL)
      AND (
          NOT COALESCE(p.is_test_user, false)
          OR (SELECT s.enabled FROM app_settings s WHERE s.key = 'show_seed_boycotts')
      )
    ORDER BY COALESCE(f.cnt, 0) DESC, p.created_at DESC
    LIMIT p_limit;
  $$;


ALTER FUNCTION "public"."get_users_by_followers"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    INSERT INTO public.profiles (id, username)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || LEFT(NEW.id::text, 8)));
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_connection_source"("p_connection_id" "uuid", "p_source_url" "text", "p_source_title" "text" DEFAULT NULL::"text", "p_source_type" character varying DEFAULT NULL::character varying, "p_source_date" "date" DEFAULT NULL::"date") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  DECLARE
      new_id UUID;
  BEGIN
      INSERT INTO connection_sources (connection_id, source_url, source_title, source_type, source_date)
      VALUES (p_connection_id, p_source_url, p_source_title, p_source_type, p_source_date)
      RETURNING id INTO new_id;
      RETURN new_id;
  END;
  $$;


ALTER FUNCTION "public"."insert_connection_source"("p_connection_id" "uuid", "p_source_url" "text", "p_source_title" "text", "p_source_type" character varying, "p_source_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_blocked"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_blocks
        WHERE blocker_id = auth.uid() AND blocked_id = p_user_id
    );
END $$;


ALTER FUNCTION "public"."is_blocked"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_following"("p_follower_id" "uuid", "p_following_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    RETURN EXISTS (
      SELECT 1 FROM user_follows
      WHERE follower_id = p_follower_id AND following_id = p_following_id
    );
  END;
  $$;


ALTER FUNCTION "public"."is_following"("p_follower_id" "uuid", "p_following_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."like_post"("p_post_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rows INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Try to insert; if already liked, do nothing
  INSERT INTO post_likes (user_id, post_id)
  VALUES (v_uid, p_post_id)
  ON CONFLICT DO NOTHING;

  -- Check if we actually inserted
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Only increment if a new like was created
  IF v_rows > 0 THEN
    UPDATE posts SET like_count = like_count + 1, updated_at = now()
    WHERE id = p_post_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."like_post"("p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."like_reply"("p_reply_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rows INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO reply_likes (user_id, reply_id)
  VALUES (v_uid, p_reply_id)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    UPDATE post_replies SET like_count = like_count + 1
    WHERE id = p_reply_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."like_reply"("p_reply_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_feed_read"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE profiles SET feed_last_read = now()
  WHERE id = v_uid;
END;
$$;


ALTER FUNCTION "public"."mark_feed_read"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_follow_request"("p_requester_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    DELETE FROM follow_requests
    WHERE requester_id = p_requester_id AND target_user_id = auth.uid();
  END;
  $$;


ALTER FUNCTION "public"."reject_follow_request"("p_requester_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_company_from_boycott"("p_boycott_id" "uuid", "p_company_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    resolved_id UUID;
    boycott_owner UUID;
BEGIN
    SELECT creator_id INTO boycott_owner FROM boycotts WHERE id = p_boycott_id;
    IF boycott_owner IS NULL THEN
        RAISE EXCEPTION 'Boycott not found';
    END IF;
    IF auth.uid() IS NULL OR auth.uid() != boycott_owner THEN
        RAISE EXCEPTION 'Unauthorized: you do not own this boycott';
    END IF;

    resolved_id := resolve_company_id(p_company_id);
    IF resolved_id IS NULL THEN
        RAISE EXCEPTION 'Company not found';
    END IF;

    DELETE FROM boycott_companies
    WHERE boycott_id = p_boycott_id AND company_id = resolved_id;
END;
$$;


ALTER FUNCTION "public"."remove_company_from_boycott"("p_boycott_id" "uuid", "p_company_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_boycott"("p_boycott_id" "uuid", "p_reason" "text", "p_details" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_uid     UUID := auth.uid();
    v_reason  boycott_report_reason;
    v_details TEXT;
    v_id      UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM boycotts WHERE id = p_boycott_id) THEN
        RAISE EXCEPTION 'boycott not found' USING ERRCODE = '22023';
    END IF;

    BEGIN
        v_reason := p_reason::boycott_report_reason;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'invalid reason: %', p_reason USING ERRCODE = '22023';
    END;

    v_details := NULLIF(btrim(p_details), '');
    IF v_reason = 'other' AND v_details IS NULL THEN
        RAISE EXCEPTION 'details are required when reason is other'
            USING ERRCODE = '22023';
    END IF;
    IF v_details IS NOT NULL AND length(v_details) > 1000 THEN
        v_details := substring(v_details FROM 1 FOR 1000);
    END IF;

    INSERT INTO boycott_reports (boycott_id, reporter_id, reason, details)
    VALUES (p_boycott_id, v_uid, v_reason, v_details)
    ON CONFLICT (boycott_id, reporter_id)
    DO UPDATE SET
        reason     = EXCLUDED.reason,
        details    = EXCLUDED.details,
        status     = 'open',
        updated_at = now()
    RETURNING id INTO v_id;

    RETURN v_id;
END $$;


ALTER FUNCTION "public"."report_boycott"("p_boycott_id" "uuid", "p_reason" "text", "p_details" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_content"("p_content_type" "text", "p_content_id" "uuid", "p_reason" "text", "p_details" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_uid     UUID := auth.uid();
    v_details TEXT;
    v_id      UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
    END IF;

    IF p_content_type = 'post' THEN
        IF NOT EXISTS (SELECT 1 FROM posts WHERE id = p_content_id) THEN
            RAISE EXCEPTION 'post not found' USING ERRCODE = '22023';
        END IF;
    ELSIF p_content_type = 'reply' THEN
        IF NOT EXISTS (SELECT 1 FROM post_replies WHERE id = p_content_id) THEN
            RAISE EXCEPTION 'reply not found' USING ERRCODE = '22023';
        END IF;
    ELSIF p_content_type = 'user' THEN
        IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_content_id) THEN
            RAISE EXCEPTION 'user not found' USING ERRCODE = '22023';
        END IF;
    ELSE
        RAISE EXCEPTION 'invalid content type: %', p_content_type
            USING ERRCODE = '22023';
    END IF;

    IF p_reason IS NULL OR p_reason NOT IN (
        'spam', 'misinformation', 'harassment', 'off_topic',
        'duplicate', 'illegal', 'inappropriate', 'other'
    ) THEN
        RAISE EXCEPTION 'invalid reason: %', p_reason USING ERRCODE = '22023';
    END IF;

    v_details := NULLIF(btrim(p_details), '');
    IF p_reason = 'other' AND v_details IS NULL THEN
        RAISE EXCEPTION 'details are required when reason is other'
            USING ERRCODE = '22023';
    END IF;
    IF v_details IS NOT NULL AND length(v_details) > 1000 THEN
        v_details := substring(v_details FROM 1 FOR 1000);
    END IF;

    INSERT INTO content_reports (reporter_id, content_type, content_id, reason, details)
    VALUES (v_uid, p_content_type, p_content_id, p_reason, v_details)
    ON CONFLICT (reporter_id, content_type, content_id)
    DO UPDATE SET
        reason     = EXCLUDED.reason,
        details    = EXCLUDED.details,
        status     = 'open',
        updated_at = now()
    RETURNING id INTO v_id;

    RETURN v_id;
END $$;


ALTER FUNCTION "public"."report_content"("p_content_type" "text", "p_content_id" "uuid", "p_reason" "text", "p_details" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."repost_post"("p_post_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_original_id UUID;
  v_original_author UUID;
  v_repost_id UUID;
  v_existing UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COALESCE(p.original_post_id, p.id), p.author_id
  INTO v_original_id, v_original_author
  FROM posts p WHERE p.id = p_post_id;

  IF v_original_id IS NULL THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  IF v_original_author = v_uid THEN
    RAISE EXCEPTION 'Cannot repost your own post';
  END IF;

  SELECT repost_id INTO v_existing
  FROM post_reposts WHERE user_id = v_uid AND post_id = v_original_id;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Already reposted';
  END IF;

  INSERT INTO posts (author_id, post_type, original_post_id)
  VALUES (v_uid, 'repost', v_original_id)
  RETURNING id INTO v_repost_id;

  INSERT INTO post_reposts (user_id, post_id, repost_id)
  VALUES (v_uid, v_original_id, v_repost_id);

  UPDATE posts SET repost_count = repost_count + 1, updated_at = now()
  WHERE id = v_original_id;

  RETURN v_repost_id;
END;
$$;


ALTER FUNCTION "public"."repost_post"("p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_company_id"("p_identifier" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
    result_id UUID;
BEGIN
    -- Try as UUID first
    BEGIN
        result_id := p_identifier::UUID;
        SELECT id INTO result_id FROM companies WHERE id = result_id;
        IF result_id IS NOT NULL THEN
            RETURN result_id;
        END IF;
    EXCEPTION WHEN invalid_text_representation THEN
        NULL;
    END;

    -- Try LEI match (20-char uppercase alphanumeric)
    IF p_identifier ~ '^[A-Z0-9]{20}$' THEN
        SELECT id INTO result_id FROM companies WHERE lei = p_identifier LIMIT 1;
        IF result_id IS NOT NULL THEN
            RETURN result_id;
        END IF;
    END IF;

    -- Try Wikidata QID match (Q followed by digits)
    IF p_identifier ~ '^Q\d+$' THEN
        SELECT id INTO result_id FROM companies WHERE wikidata_qid = p_identifier LIMIT 1;
        IF result_id IS NOT NULL THEN
            RETURN result_id;
        END IF;
    END IF;

    -- Try exact name match
    SELECT id INTO result_id FROM companies WHERE name = p_identifier LIMIT 1;
    IF result_id IS NOT NULL THEN
        RETURN result_id;
    END IF;

    -- Try case-insensitive name match
    SELECT id INTO result_id FROM companies WHERE LOWER(name) = LOWER(p_identifier) LIMIT 1;
    RETURN result_id;
END;
$_$;


ALTER FUNCTION "public"."resolve_company_id"("p_identifier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_companies"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "name" character varying, "description" "text", "website" character varying, "logo_url" character varying)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    RETURN QUERY
    SELECT
      c.id,
      c.name,
      c.description,
      c.website,
      c.logo_url
    FROM companies c
    WHERE c.name ILIKE '%' || p_query || '%'
    ORDER BY
      CASE WHEN c.name ILIKE p_query || '%' THEN 0 ELSE 1 END,
      c.name
    LIMIT p_limit;
  END;
  $$;


ALTER FUNCTION "public"."search_companies"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_users"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "username" character varying, "display_name" "text", "profile_picture_url" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    RETURN QUERY
    SELECT profiles.id, profiles.username, profiles.display_name::text, profiles.profile_picture_url
    FROM profiles
    WHERE (profiles.username ILIKE '%' || p_query || '%'
        OR profiles.display_name ILIKE '%' || p_query || '%')
      AND (
          NOT COALESCE(profiles.is_test_user, false)
          OR (SELECT s.enabled FROM app_settings s WHERE s.key = 'show_seed_boycotts')
      )
      -- Block filter: hide users the caller has blocked or who blocked the caller
      AND (
          auth.uid() IS NULL
          OR NOT EXISTS (
              SELECT 1 FROM user_blocks ub
              WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = profiles.id)
                 OR (ub.blocker_id = profiles.id AND ub.blocked_id = auth.uid())
          )
      )
    LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."search_users"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_follow_request"("p_target_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    INSERT INTO follow_requests (requester_id, target_user_id, status)
    VALUES (auth.uid(), p_target_user_id, 'pending');
  END;
  $$;


ALTER FUNCTION "public"."send_follow_request"("p_target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_message"("p_conversation_id" "uuid", "p_content" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_message_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM conversation_participants
        WHERE conversation_id = p_conversation_id AND user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    v_message_id := gen_random_uuid();

    INSERT INTO messages (id, conversation_id, sender_id, content)
    VALUES (v_message_id, p_conversation_id, v_user_id, p_content);

    UPDATE conversations SET updated_at = NOW() WHERE id = p_conversation_id;

    RETURN v_message_id;
END;
$$;


ALTER FUNCTION "public"."send_message"("p_conversation_id" "uuid", "p_content" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_user_role"("p_user_id" "uuid", "p_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Only admins may set roles';
  END IF;
  IF p_role IS NOT NULL AND p_role NOT IN ('admin', 'moderator') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;
  UPDATE public.profiles SET role = p_role WHERE id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."set_user_role"("p_user_id" "uuid", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uc_can_view_boycott"("b_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  select exists (
    select 1 from public.boycotts b
    where b.id = b_id
      and (
        b.creator_id = auth.uid()
        or b.is_public = true
        or exists (
          select 1 from public.adopted_boycotts a
          where a.boycott_id = b.id and a.user_id = auth.uid()
        )
      )
  );
$$;


ALTER FUNCTION "public"."uc_can_view_boycott"("b_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uc_cascade_user_company_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
begin
  delete from public.user_connections
   where (source_kind = 'user' and source_id = old.id::text)
      or (target_kind = 'user' and target_id = old.id::text);
  delete from public.user_evidence
   where attaches_kind = 'user_company' and attaches_id = old.id;
  delete from public.user_claim_votes
   where target_kind = 'user_company' and target_id = old.id;
  return old;
end;
$$;


ALTER FUNCTION "public"."uc_cascade_user_company_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uc_cascade_user_connection_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
begin
  delete from public.user_evidence
   where attaches_kind = 'user_connection' and attaches_id = old.id;
  delete from public.user_claim_votes
   where target_kind = 'user_connection' and target_id = old.id;
  return old;
end;
$$;


ALTER FUNCTION "public"."uc_cascade_user_connection_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uc_evidence_parent_boycott"("parent_kind" "text", "parent_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  select case parent_kind
    when 'user_company'    then (select uc.boycott_id from public.user_companies uc where uc.id = parent_id)
    when 'user_connection' then (select cn.boycott_id from public.user_connections cn where cn.id = parent_id)
    else null end;
$$;


ALTER FUNCTION "public"."uc_evidence_parent_boycott"("parent_kind" "text", "parent_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uc_owns_boycott"("b_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  select exists (select 1 from public.boycotts b where b.id = b_id and b.creator_id = auth.uid());
$$;


ALTER FUNCTION "public"."uc_owns_boycott"("b_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unadopt_boycott"("p_boycott_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    DELETE FROM adopted_boycotts WHERE user_id = auth.uid() AND boycott_id = p_boycott_id;
  END;
  $$;


ALTER FUNCTION "public"."unadopt_boycott"("p_boycott_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unblock_user"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
    END IF;

    DELETE FROM user_blocks
    WHERE blocker_id = v_uid AND blocked_id = p_user_id;
END $$;


ALTER FUNCTION "public"."unblock_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unfollow_user"("p_following_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    DELETE FROM user_follows WHERE follower_id = auth.uid() AND following_id = p_following_id;
  END;
  $$;


ALTER FUNCTION "public"."unfollow_user"("p_following_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unlike_post"("p_post_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_deleted INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM post_likes WHERE user_id = v_uid AND post_id = p_post_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Only decrement if a like was actually removed
  IF v_deleted > 0 THEN
    UPDATE posts SET like_count = GREATEST(like_count - 1, 0), updated_at = now()
    WHERE id = p_post_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."unlike_post"("p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unlike_reply"("p_reply_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rows INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM reply_likes
  WHERE user_id = v_uid AND reply_id = p_reply_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    UPDATE post_replies SET like_count = GREATEST(0, like_count - 1)
    WHERE id = p_reply_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."unlike_reply"("p_reply_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unrepost_post"("p_post_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_original_id UUID;
  v_repost_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COALESCE(p.original_post_id, p.id)
  INTO v_original_id
  FROM posts p WHERE p.id = p_post_id;

  IF v_original_id IS NULL THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  DELETE FROM post_reposts
  WHERE user_id = v_uid AND post_id = v_original_id
  RETURNING repost_id INTO v_repost_id;

  IF v_repost_id IS NULL THEN
    RAISE EXCEPTION 'Not reposted';
  END IF;

  DELETE FROM posts WHERE id = v_repost_id AND author_id = v_uid;

  UPDATE posts SET repost_count = GREATEST(repost_count - 1, 0), updated_at = now()
  WHERE id = v_original_id;
END;
$$;


ALTER FUNCTION "public"."unrepost_post"("p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_agent_conversation_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_agent_conversation_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_boycott"("boycott_id" "uuid", "new_name" "text", "new_description" "text", "new_is_public" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    UPDATE boycotts
    SET name = COALESCE(new_name, name),
        description = COALESCE(new_description, description),
        is_public = COALESCE(new_is_public, is_public)
    WHERE id = boycott_id AND creator_id = auth.uid();
  END;
  $$;


ALTER FUNCTION "public"."update_boycott"("boycott_id" "uuid", "new_name" "text", "new_description" "text", "new_is_public" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_boycott"("p_boycott_id" "uuid", "p_name" character varying, "p_description" "text", "p_is_public" boolean, "p_source_links" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM boycotts WHERE id = p_boycott_id AND creator_id = v_user_id) THEN
        RAISE EXCEPTION 'Not authorized to edit this boycott';
    END IF;

    UPDATE boycotts
    SET name = p_name,
        description = p_description,
        is_public = p_is_public,
        source_links = COALESCE(p_source_links, source_links)
    WHERE id = p_boycott_id AND creator_id = v_user_id;
END;
$$;


ALTER FUNCTION "public"."update_boycott"("p_boycott_id" "uuid", "p_name" character varying, "p_description" "text", "p_is_public" boolean, "p_source_links" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_boycott_company"("p_boycott_id" "uuid", "p_company_id" "text", "p_block_owns" boolean, "p_block_owned_by" boolean, "p_block_suppliers" boolean, "p_block_brands" boolean DEFAULT false, "p_block_customers" boolean DEFAULT false) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    resolved_id UUID;
    boycott_owner UUID;
BEGIN
    -- Verify the caller owns this boycott
    SELECT creator_id INTO boycott_owner FROM boycotts WHERE id = p_boycott_id;
    IF boycott_owner IS NULL THEN
        RAISE EXCEPTION 'Boycott not found';
    END IF;
    IF auth.uid() IS NULL OR auth.uid() != boycott_owner THEN
        RAISE EXCEPTION 'Unauthorized: you do not own this boycott';
    END IF;

    resolved_id := resolve_company_id(p_company_id);

    IF resolved_id IS NULL THEN
        RAISE EXCEPTION 'Company not found';
    END IF;

    UPDATE boycott_companies
    SET
        block_owns = p_block_owns,
        block_owned_by = p_block_owned_by,
        block_suppliers = p_block_suppliers,
        block_brands = p_block_brands,
        block_customers = p_block_customers
    WHERE boycott_id = p_boycott_id AND company_id = resolved_id;
END;
$$;


ALTER FUNCTION "public"."update_boycott_company"("p_boycott_id" "uuid", "p_company_id" "text", "p_block_owns" boolean, "p_block_owned_by" boolean, "p_block_suppliers" boolean, "p_block_brands" boolean, "p_block_customers" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_demo_access_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_demo_access_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_feedback_status"("feedback_id" "uuid", "new_status" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE feedback
  SET
    status = new_status,
    resolved_at = CASE WHEN new_status = 'resolved' THEN NOW() ELSE resolved_at END
  WHERE id = feedback_id;
END;
$$;


ALTER FUNCTION "public"."update_feedback_status"("feedback_id" "uuid", "new_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_feedback_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_feedback_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_full_profile"("p_username" "text", "p_display_name" "text", "p_bio" "text", "p_profile_picture_url" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    UPDATE profiles
    SET
        username = COALESCE(p_username, username),
        display_name = p_display_name,
        bio = p_bio,
        profile_picture_url = p_profile_picture_url,
        updated_at = NOW()
    WHERE id = auth.uid();
END;
$$;


ALTER FUNCTION "public"."update_full_profile"("p_username" "text", "p_display_name" "text", "p_bio" "text", "p_profile_picture_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_profile_display_name"("user_id" "uuid", "new_display_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    UPDATE profiles SET display_name = new_display_name WHERE id = user_id AND auth.uid() = user_id;
  END;
  $$;


ALTER FUNCTION "public"."update_profile_display_name"("user_id" "uuid", "new_display_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_profile_picture"("user_id" "uuid", "new_url" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    UPDATE profiles SET profile_picture_url = new_url WHERE id = user_id AND auth.uid() = user_id;
  END;
  $$;


ALTER FUNCTION "public"."update_profile_picture"("user_id" "uuid", "new_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_profile_privacy"("user_id" "uuid", "new_privacy" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  BEGIN
    UPDATE profiles SET is_private = new_privacy WHERE id = user_id AND auth.uid() = user_id;
  END;
  $$;


ALTER FUNCTION "public"."update_profile_privacy"("user_id" "uuid", "new_privacy" boolean) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."adopted_boycotts" (
    "user_id" "uuid" NOT NULL,
    "boycott_id" "uuid" NOT NULL,
    "adopted_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."adopted_boycotts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "feedback_id" "uuid",
    "user_id" "uuid",
    "user_name" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "summary" "text"
);


ALTER TABLE "public"."agent_conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "conversation_id" "uuid",
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "actions_taken" "jsonb",
    "pr_url" "text",
    "status" "text" DEFAULT 'complete'::"text",
    "actions_url" "text"
);


ALTER TABLE "public"."agent_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "key" "text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."boycott_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "boycott_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "label" "text",
    "media_url" "text",
    "media_type" "text",
    CONSTRAINT "boycott_comments_content_check" CHECK ((("char_length"("content") >= 1) AND ("char_length"("content") <= 1000))),
    CONSTRAINT "boycott_comments_label_check" CHECK ((("label" IS NULL) OR ("label" = ANY (ARRAY['alternative'::"text", 'correction'::"text"]))))
);


ALTER TABLE "public"."boycott_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."boycott_companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "boycott_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "block_owns" boolean DEFAULT false,
    "block_owned_by" boolean DEFAULT false,
    "block_suppliers" boolean DEFAULT false,
    "added_at" timestamp with time zone DEFAULT "now"(),
    "block_brands" boolean DEFAULT false,
    "block_customers" boolean DEFAULT false
);


ALTER TABLE "public"."boycott_companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."boycott_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "boycott_id" "uuid" NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "reason" "public"."boycott_report_reason" NOT NULL,
    "details" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "boycott_reports_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'reviewed'::"text", 'dismissed'::"text", 'actioned'::"text"])))
);


ALTER TABLE "public"."boycott_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."boycott_updates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "boycott_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "summary" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "boycott_updates_summary_check" CHECK ((("char_length"("summary") >= 1) AND ("char_length"("summary") <= 500)))
);


ALTER TABLE "public"."boycott_updates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."boycotts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "creator_id" "uuid" NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "is_public" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "source_links" "jsonb" DEFAULT '[]'::"jsonb",
    "og_image_url" "text",
    "is_seed" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."boycotts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "website" character varying(500),
    "logo_url" character varying(500),
    "lei" character varying(20),
    "cik" character varying(10),
    "wikidata_qid" character varying(20),
    "littlesis_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "content_type" "text" NOT NULL,
    "content_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "details" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "content_reports_content_type_check" CHECK (("content_type" = ANY (ARRAY['post'::"text", 'reply'::"text", 'user'::"text"]))),
    CONSTRAINT "content_reports_reason_check" CHECK (("reason" = ANY (ARRAY['spam'::"text", 'misinformation'::"text", 'harassment'::"text", 'off_topic'::"text", 'duplicate'::"text", 'illegal'::"text", 'inappropriate'::"text", 'other'::"text"]))),
    CONSTRAINT "content_reports_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'reviewed'::"text", 'dismissed'::"text", 'actioned'::"text"])))
);


ALTER TABLE "public"."content_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."conversation_participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."demo_access" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "name" "text" NOT NULL,
    "envelope_id" "text",
    "status" "text" DEFAULT 'pending_signature'::"text" NOT NULL,
    "source" "text",
    "signed_at" timestamp with time zone,
    "access_granted_at" timestamp with time zone,
    "access_expires_at" timestamp with time zone,
    "access_revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "temp_password" "text",
    "google_sheet_url" "text",
    CONSTRAINT "demo_access_status_check" CHECK (("status" = ANY (ARRAY['pending_signature'::"text", 'signed'::"text", 'access_granted'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."demo_access" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "submitted_by" "uuid",
    "submitted_by_name" "text" NOT NULL,
    "submitted_by_email" "text",
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "category" "text" DEFAULT 'bug'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "resolution_notes" "text",
    "resolved_at" timestamp with time zone,
    "affected_area" "text",
    "steps_to_reproduce" "text",
    "attachments" "text"[],
    "fix_in_progress" boolean DEFAULT false,
    "fix_triggered_at" timestamp with time zone
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "feedback_id" "uuid",
    "author_name" "text" NOT NULL,
    "author_id" "uuid",
    "content" "text" NOT NULL,
    "is_status_update" boolean DEFAULT false,
    "type" "text" DEFAULT 'comment'::"text",
    CONSTRAINT "feedback_comments_type_check" CHECK (("type" = ANY (ARRAY['comment'::"text", 'ai_context'::"text"])))
);


ALTER TABLE "public"."feedback_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."follow_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requester_id" "uuid" NOT NULL,
    "target_user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "follow_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."follow_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."link_previews" (
    "url" "text" NOT NULL,
    "title" "text",
    "description" "text",
    "image_url" "text",
    "site_name" "text",
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."link_previews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "read_at" timestamp with time zone,
    CONSTRAINT "messages_content_check" CHECK ((("char_length"("content") >= 1) AND ("char_length"("content") <= 2000)))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plaid_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "item_id" "text" NOT NULL,
    "access_token" "text" NOT NULL,
    "institution_name" "text",
    "cursor" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_synced_at" timestamp with time zone
);


ALTER TABLE "public"."plaid_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plaid_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plaid_item_id" "uuid" NOT NULL,
    "transaction_id" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "merchant_name" "text",
    "date" "date" NOT NULL,
    "category" "text"[],
    "matched_company_id" "uuid",
    "match_confidence" numeric(3,2),
    "is_boycotted" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."plaid_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."post_likes" (
    "user_id" "uuid" NOT NULL,
    "post_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."post_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."post_media" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "media_url" "text" NOT NULL,
    "media_type" "text" DEFAULT 'image/jpeg'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."post_media" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."post_replies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "parent_reply_id" "uuid",
    "like_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "post_replies_content_check" CHECK (("char_length"("content") <= 2000))
);


ALTER TABLE "public"."post_replies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."post_reposts" (
    "user_id" "uuid" NOT NULL,
    "post_id" "uuid" NOT NULL,
    "repost_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."post_reposts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author_id" "uuid" NOT NULL,
    "post_type" "text" NOT NULL,
    "content" "text",
    "boycott_id" "uuid",
    "original_post_id" "uuid",
    "media_url" "text",
    "media_type" "text",
    "link_url" "text",
    "like_count" integer DEFAULT 0 NOT NULL,
    "reply_count" integer DEFAULT 0 NOT NULL,
    "repost_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "audience" "text" DEFAULT 'everyone'::"text" NOT NULL,
    CONSTRAINT "posts_audience_check" CHECK (("audience" = ANY (ARRAY['everyone'::"text", 'followers'::"text", 'just_me'::"text"]))),
    CONSTRAINT "posts_content_check" CHECK (("char_length"("content") <= 300)),
    CONSTRAINT "posts_post_type_check" CHECK (("post_type" = ANY (ARRAY['text'::"text", 'boycott_share'::"text", 'boycott_repost'::"text", 'repost'::"text"])))
);


ALTER TABLE "public"."posts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."posts_companies" (
    "id" bigint NOT NULL,
    "post_id" "uuid" NOT NULL,
    "company_id" "text" NOT NULL,
    "company_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."posts_companies" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."posts_companies_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."posts_companies_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."posts_companies_id_seq" OWNED BY "public"."posts_companies"."id";



CREATE TABLE IF NOT EXISTS "public"."product_alternatives" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "target_company_id" "text" NOT NULL,
    "alternative_company_id" "text" NOT NULL,
    "is_sponsored" boolean DEFAULT false NOT NULL,
    "display_priority" integer DEFAULT 0 NOT NULL,
    "pitch" "text",
    "sponsor_starts_at" timestamp with time zone,
    "sponsor_ends_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_alternatives_pitch_check" CHECK ((("pitch" IS NULL) OR ("char_length"("pitch") <= 280)))
);


ALTER TABLE "public"."product_alternatives" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" character varying(50) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_private" boolean DEFAULT false,
    "display_name" "text",
    "profile_picture_url" "text",
    "bio" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "feed_last_read" timestamp with time zone,
    "role" "text",
    "is_test_user" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."is_test_user" IS 'Seeded/fake account. Hidden from all public listings (boycotts, search, leaderboards, profile/post reads) unless app_settings.show_seed_boycotts is enabled.';



CREATE TABLE IF NOT EXISTS "public"."reply_likes" (
    "user_id" "uuid" NOT NULL,
    "reply_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reply_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sheet_sync_state" (
    "table_name" "text" NOT NULL,
    "last_synced_at" timestamp with time zone DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone NOT NULL,
    "last_run_at" timestamp with time zone,
    "last_error" "text",
    "rows_synced" bigint DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."sheet_sync_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_blocks" (
    "blocker_id" "uuid" NOT NULL,
    "blocked_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_blocks_check" CHECK (("blocker_id" <> "blocked_id"))
);


ALTER TABLE "public"."user_blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_claim_votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "target_kind" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "voter_id" "uuid" NOT NULL,
    "stance" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_claim_votes_stance_check" CHECK (("stance" = ANY (ARRAY['agree'::"text", 'disagree'::"text"]))),
    CONSTRAINT "user_claim_votes_target_kind_check" CHECK (("target_kind" = ANY (ARRAY['user_company'::"text", 'user_connection'::"text"])))
);


ALTER TABLE "public"."user_claim_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "boycott_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "neo4j_id" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_companies_description_check" CHECK (("length"("description") <= 500)),
    CONSTRAINT "user_companies_name_check" CHECK ((("length"("name") >= 1) AND ("length"("name") <= 200)))
);


ALTER TABLE "public"."user_companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "boycott_id" "uuid" NOT NULL,
    "source_kind" "text" NOT NULL,
    "source_id" "text" NOT NULL,
    "target_kind" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "relation" "text" NOT NULL,
    "relation_label" "text",
    "description" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_connections_check" CHECK (((("relation" = 'other'::"text") AND (("length"(COALESCE("relation_label", ''::"text")) >= 1) AND ("length"(COALESCE("relation_label", ''::"text")) <= 80))) OR (("relation" <> 'other'::"text") AND ("relation_label" IS NULL)))),
    CONSTRAINT "user_connections_description_check" CHECK (("length"("description") <= 500)),
    CONSTRAINT "user_connections_relation_check" CHECK (("relation" = ANY (ARRAY['owns'::"text", 'owned_by'::"text", 'subsidiary_of'::"text", 'supplies'::"text", 'customer_of'::"text", 'brand_of'::"text", 'funds'::"text", 'invests_in'::"text", 'partner_of'::"text", 'member_of'::"text", 'other'::"text"]))),
    CONSTRAINT "user_connections_source_kind_check" CHECK (("source_kind" = ANY (ARRAY['neo4j'::"text", 'user'::"text"]))),
    CONSTRAINT "user_connections_target_kind_check" CHECK (("target_kind" = ANY (ARRAY['neo4j'::"text", 'user'::"text"])))
);


ALTER TABLE "public"."user_connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_evidence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "attaches_kind" "text" NOT NULL,
    "attaches_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "quote" "text",
    "source_label" "text",
    "accessed_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_evidence_attaches_kind_check" CHECK (("attaches_kind" = ANY (ARRAY['user_company'::"text", 'user_connection'::"text"]))),
    CONSTRAINT "user_evidence_quote_check" CHECK (("length"("quote") <= 1000)),
    CONSTRAINT "user_evidence_source_label_check" CHECK (("length"(COALESCE("source_label", ''::"text")) <= 80)),
    CONSTRAINT "user_evidence_url_check" CHECK (("url" ~ '^https?://'::"text"))
);


ALTER TABLE "public"."user_evidence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email" "text",
    "message" "text" NOT NULL,
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_follows" (
    "follower_id" "uuid" NOT NULL,
    "following_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_follows_check" CHECK (("follower_id" <> "following_id"))
);


ALTER TABLE "public"."user_follows" OWNER TO "postgres";


ALTER TABLE ONLY "public"."posts_companies" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."posts_companies_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."adopted_boycotts"
    ADD CONSTRAINT "adopted_boycotts_pkey" PRIMARY KEY ("user_id", "boycott_id");



ALTER TABLE ONLY "public"."agent_conversations"
    ADD CONSTRAINT "agent_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_messages"
    ADD CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."boycott_comments"
    ADD CONSTRAINT "boycott_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."boycott_companies"
    ADD CONSTRAINT "boycott_companies_boycott_id_company_id_key" UNIQUE ("boycott_id", "company_id");



ALTER TABLE ONLY "public"."boycott_companies"
    ADD CONSTRAINT "boycott_companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."boycott_reports"
    ADD CONSTRAINT "boycott_reports_boycott_id_reporter_id_key" UNIQUE ("boycott_id", "reporter_id");



ALTER TABLE ONLY "public"."boycott_reports"
    ADD CONSTRAINT "boycott_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."boycott_updates"
    ADD CONSTRAINT "boycott_updates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."boycotts"
    ADD CONSTRAINT "boycotts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_reporter_id_content_type_content_id_key" UNIQUE ("reporter_id", "content_type", "content_id");



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_conversation_id_user_id_key" UNIQUE ("conversation_id", "user_id");



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."demo_access"
    ADD CONSTRAINT "demo_access_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback_comments"
    ADD CONSTRAINT "feedback_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."follow_requests"
    ADD CONSTRAINT "follow_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."follow_requests"
    ADD CONSTRAINT "follow_requests_requester_id_target_user_id_key" UNIQUE ("requester_id", "target_user_id");



ALTER TABLE ONLY "public"."link_previews"
    ADD CONSTRAINT "link_previews_pkey" PRIMARY KEY ("url");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plaid_items"
    ADD CONSTRAINT "plaid_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plaid_items"
    ADD CONSTRAINT "plaid_items_user_id_item_id_key" UNIQUE ("user_id", "item_id");



ALTER TABLE ONLY "public"."plaid_transactions"
    ADD CONSTRAINT "plaid_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plaid_transactions"
    ADD CONSTRAINT "plaid_transactions_transaction_id_key" UNIQUE ("transaction_id");



ALTER TABLE ONLY "public"."post_likes"
    ADD CONSTRAINT "post_likes_pkey" PRIMARY KEY ("user_id", "post_id");



ALTER TABLE ONLY "public"."post_media"
    ADD CONSTRAINT "post_media_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."post_replies"
    ADD CONSTRAINT "post_replies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."post_reposts"
    ADD CONSTRAINT "post_reposts_pkey" PRIMARY KEY ("user_id", "post_id");



ALTER TABLE ONLY "public"."posts_companies"
    ADD CONSTRAINT "posts_companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."posts_companies"
    ADD CONSTRAINT "posts_companies_post_id_company_id_key" UNIQUE ("post_id", "company_id");



ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_alternatives"
    ADD CONSTRAINT "product_alternatives_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_alternatives"
    ADD CONSTRAINT "product_alternatives_target_company_id_alternative_company__key" UNIQUE ("target_company_id", "alternative_company_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."reply_likes"
    ADD CONSTRAINT "reply_likes_pkey" PRIMARY KEY ("user_id", "reply_id");



ALTER TABLE ONLY "public"."sheet_sync_state"
    ADD CONSTRAINT "sheet_sync_state_pkey" PRIMARY KEY ("table_name");



ALTER TABLE ONLY "public"."user_blocks"
    ADD CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("blocker_id", "blocked_id");



ALTER TABLE ONLY "public"."user_claim_votes"
    ADD CONSTRAINT "user_claim_votes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_claim_votes"
    ADD CONSTRAINT "user_claim_votes_target_kind_target_id_voter_id_key" UNIQUE ("target_kind", "target_id", "voter_id");



ALTER TABLE ONLY "public"."user_companies"
    ADD CONSTRAINT "user_companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_connections"
    ADD CONSTRAINT "user_connections_boycott_id_source_kind_source_id_target_ki_key" UNIQUE ("boycott_id", "source_kind", "source_id", "target_kind", "target_id", "relation", "relation_label");



ALTER TABLE ONLY "public"."user_connections"
    ADD CONSTRAINT "user_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_evidence"
    ADD CONSTRAINT "user_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_feedback"
    ADD CONSTRAINT "user_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_follows"
    ADD CONSTRAINT "user_follows_pkey" PRIMARY KEY ("follower_id", "following_id");



CREATE INDEX "adopted_boycotts_boycott_id_idx" ON "public"."adopted_boycotts" USING "btree" ("boycott_id");



CREATE INDEX "boycott_reports_boycott_id_idx" ON "public"."boycott_reports" USING "btree" ("boycott_id");



CREATE INDEX "boycott_reports_open_idx" ON "public"."boycott_reports" USING "btree" ("status") WHERE ("status" = 'open'::"text");



CREATE INDEX "boycott_reports_reporter_id_idx" ON "public"."boycott_reports" USING "btree" ("reporter_id");



CREATE INDEX "boycott_reports_reviewed_by_idx" ON "public"."boycott_reports" USING "btree" ("reviewed_by");



CREATE INDEX "boycott_updates_author_id_idx" ON "public"."boycott_updates" USING "btree" ("author_id");



CREATE UNIQUE INDEX "boycotts_creator_name_unique" ON "public"."boycotts" USING "btree" ("creator_id", "lower"(("name")::"text"));



CREATE INDEX "content_reports_content_idx" ON "public"."content_reports" USING "btree" ("content_type", "content_id");



CREATE INDEX "content_reports_open_idx" ON "public"."content_reports" USING "btree" ("status") WHERE ("status" = 'open'::"text");



CREATE INDEX "content_reports_reviewed_by_idx" ON "public"."content_reports" USING "btree" ("reviewed_by");



CREATE INDEX "feedback_comments_author_id_idx" ON "public"."feedback_comments" USING "btree" ("author_id");



CREATE INDEX "feedback_submitted_by_idx" ON "public"."feedback" USING "btree" ("submitted_by");



CREATE INDEX "idx_adopted_boycotts_user" ON "public"."adopted_boycotts" USING "btree" ("user_id");



CREATE INDEX "idx_agent_conversations_feedback_id" ON "public"."agent_conversations" USING "btree" ("feedback_id");



CREATE INDEX "idx_agent_conversations_status" ON "public"."agent_conversations" USING "btree" ("status");



CREATE INDEX "idx_agent_conversations_user_id" ON "public"."agent_conversations" USING "btree" ("user_id");



CREATE INDEX "idx_agent_messages_conversation_id" ON "public"."agent_messages" USING "btree" ("conversation_id");



CREATE INDEX "idx_boycott_comments_boycott_id" ON "public"."boycott_comments" USING "btree" ("boycott_id", "created_at");



CREATE INDEX "idx_boycott_comments_user_id" ON "public"."boycott_comments" USING "btree" ("user_id");



CREATE INDEX "idx_boycott_companies_boycott" ON "public"."boycott_companies" USING "btree" ("boycott_id");



CREATE INDEX "idx_boycott_companies_company" ON "public"."boycott_companies" USING "btree" ("company_id");



CREATE INDEX "idx_boycott_updates_boycott" ON "public"."boycott_updates" USING "btree" ("boycott_id", "created_at" DESC);



CREATE INDEX "idx_boycotts_creator" ON "public"."boycotts" USING "btree" ("creator_id");



CREATE INDEX "idx_boycotts_public" ON "public"."boycotts" USING "btree" ("is_public") WHERE ("is_public" = true);



CREATE INDEX "idx_conversation_participants_conversation_id" ON "public"."conversation_participants" USING "btree" ("conversation_id");



CREATE INDEX "idx_conversation_participants_user_id" ON "public"."conversation_participants" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_demo_access_active_email" ON "public"."demo_access" USING "btree" ("email") WHERE ("status" = ANY (ARRAY['pending_signature'::"text", 'signed'::"text", 'access_granted'::"text"]));



CREATE UNIQUE INDEX "idx_demo_access_envelope_id" ON "public"."demo_access" USING "btree" ("envelope_id") WHERE ("envelope_id" IS NOT NULL);



CREATE INDEX "idx_demo_access_expiry" ON "public"."demo_access" USING "btree" ("access_expires_at") WHERE ("status" = 'access_granted'::"text");



CREATE INDEX "idx_feedback_category" ON "public"."feedback" USING "btree" ("category");



CREATE INDEX "idx_feedback_comments_feedback_id" ON "public"."feedback_comments" USING "btree" ("feedback_id");



CREATE INDEX "idx_feedback_comments_type" ON "public"."feedback_comments" USING "btree" ("feedback_id", "type");



CREATE INDEX "idx_feedback_created_at" ON "public"."feedback" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_feedback_status" ON "public"."feedback" USING "btree" ("status");



CREATE INDEX "idx_follow_requests_requester" ON "public"."follow_requests" USING "btree" ("requester_id");



CREATE INDEX "idx_follow_requests_status" ON "public"."follow_requests" USING "btree" ("status");



CREATE INDEX "idx_follow_requests_target" ON "public"."follow_requests" USING "btree" ("target_user_id");



CREATE INDEX "idx_messages_conversation_id" ON "public"."messages" USING "btree" ("conversation_id", "created_at");



CREATE INDEX "idx_messages_sender_id" ON "public"."messages" USING "btree" ("sender_id");



CREATE INDEX "idx_plaid_items_user_id" ON "public"."plaid_items" USING "btree" ("user_id");



CREATE INDEX "idx_plaid_transactions_date" ON "public"."plaid_transactions" USING "btree" ("date");



CREATE INDEX "idx_plaid_transactions_is_boycotted" ON "public"."plaid_transactions" USING "btree" ("is_boycotted");



CREATE INDEX "idx_plaid_transactions_matched_company_id" ON "public"."plaid_transactions" USING "btree" ("matched_company_id");



CREATE INDEX "idx_plaid_transactions_plaid_item_id" ON "public"."plaid_transactions" USING "btree" ("plaid_item_id");



CREATE INDEX "idx_plaid_transactions_user_id" ON "public"."plaid_transactions" USING "btree" ("user_id");



CREATE INDEX "idx_post_media_post_sort" ON "public"."post_media" USING "btree" ("post_id", "sort_order");



CREATE INDEX "idx_post_replies_parent" ON "public"."post_replies" USING "btree" ("parent_reply_id");



CREATE INDEX "idx_post_replies_post" ON "public"."post_replies" USING "btree" ("post_id", "created_at");



CREATE INDEX "idx_posts_audience" ON "public"."posts" USING "btree" ("audience") WHERE ("audience" <> 'everyone'::"text");



CREATE INDEX "idx_posts_author_created" ON "public"."posts" USING "btree" ("author_id", "created_at" DESC);



CREATE INDEX "idx_posts_boycott" ON "public"."posts" USING "btree" ("boycott_id") WHERE ("boycott_id" IS NOT NULL);



CREATE INDEX "idx_posts_companies_company" ON "public"."posts_companies" USING "btree" ("company_id");



CREATE INDEX "idx_posts_companies_post" ON "public"."posts_companies" USING "btree" ("post_id");



CREATE INDEX "idx_posts_created" ON "public"."posts" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_product_alternatives_target" ON "public"."product_alternatives" USING "btree" ("target_company_id");



CREATE INDEX "idx_reply_likes_reply" ON "public"."reply_likes" USING "btree" ("reply_id");



CREATE INDEX "idx_user_follows_follower" ON "public"."user_follows" USING "btree" ("follower_id");



CREATE INDEX "idx_user_follows_following" ON "public"."user_follows" USING "btree" ("following_id");



CREATE INDEX "post_likes_post_id_idx" ON "public"."post_likes" USING "btree" ("post_id");



CREATE INDEX "post_replies_author_id_idx" ON "public"."post_replies" USING "btree" ("author_id");



CREATE INDEX "post_reposts_post_id_idx" ON "public"."post_reposts" USING "btree" ("post_id");



CREATE INDEX "post_reposts_repost_id_idx" ON "public"."post_reposts" USING "btree" ("repost_id");



CREATE INDEX "posts_original_post_id_idx" ON "public"."posts" USING "btree" ("original_post_id");



CREATE INDEX "profiles_is_test_user_idx" ON "public"."profiles" USING "btree" ("is_test_user") WHERE ("is_test_user" = true);



CREATE INDEX "user_blocks_blocked_id_idx" ON "public"."user_blocks" USING "btree" ("blocked_id");



CREATE INDEX "user_claim_votes_target_idx" ON "public"."user_claim_votes" USING "btree" ("target_kind", "target_id");



CREATE INDEX "user_claim_votes_voter_id_idx" ON "public"."user_claim_votes" USING "btree" ("voter_id");



CREATE INDEX "user_companies_boycott_idx" ON "public"."user_companies" USING "btree" ("boycott_id");



CREATE INDEX "user_companies_created_by_idx" ON "public"."user_companies" USING "btree" ("created_by");



CREATE INDEX "user_connections_boycott_idx" ON "public"."user_connections" USING "btree" ("boycott_id");



CREATE INDEX "user_connections_created_by_idx" ON "public"."user_connections" USING "btree" ("created_by");



CREATE INDEX "user_evidence_attaches_idx" ON "public"."user_evidence" USING "btree" ("attaches_kind", "attaches_id");



CREATE INDEX "user_evidence_created_by_idx" ON "public"."user_evidence" USING "btree" ("created_by");



CREATE INDEX "user_feedback_user_id_idx" ON "public"."user_feedback" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "agent_conversation_updated_at" BEFORE UPDATE ON "public"."agent_conversations" FOR EACH ROW EXECUTE FUNCTION "public"."update_agent_conversation_updated_at"();



CREATE OR REPLACE TRIGGER "boycott_reports_guard_moderation" BEFORE UPDATE ON "public"."boycott_reports" FOR EACH ROW EXECUTE FUNCTION "public"."boycott_reports_block_moderation_edits"();



CREATE OR REPLACE TRIGGER "demo_access_updated_at" BEFORE UPDATE ON "public"."demo_access" FOR EACH ROW EXECUTE FUNCTION "public"."update_demo_access_updated_at"();



CREATE OR REPLACE TRIGGER "enforce_role_change_is_privileged" BEFORE INSERT OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_role_change_is_privileged"();



CREATE OR REPLACE TRIGGER "feedback_updated_at" BEFORE UPDATE ON "public"."feedback" FOR EACH ROW EXECUTE FUNCTION "public"."update_feedback_updated_at"();



CREATE OR REPLACE TRIGGER "trg_uc_cascade_user_company_delete" AFTER DELETE ON "public"."user_companies" FOR EACH ROW EXECUTE FUNCTION "public"."uc_cascade_user_company_delete"();



CREATE OR REPLACE TRIGGER "trg_uc_cascade_user_connection_delete" AFTER DELETE ON "public"."user_connections" FOR EACH ROW EXECUTE FUNCTION "public"."uc_cascade_user_connection_delete"();



ALTER TABLE ONLY "public"."adopted_boycotts"
    ADD CONSTRAINT "adopted_boycotts_boycott_id_fkey" FOREIGN KEY ("boycott_id") REFERENCES "public"."boycotts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."adopted_boycotts"
    ADD CONSTRAINT "adopted_boycotts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_conversations"
    ADD CONSTRAINT "agent_conversations_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agent_conversations"
    ADD CONSTRAINT "agent_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."agent_messages"
    ADD CONSTRAINT "agent_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boycott_comments"
    ADD CONSTRAINT "boycott_comments_boycott_id_fkey" FOREIGN KEY ("boycott_id") REFERENCES "public"."boycotts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boycott_comments"
    ADD CONSTRAINT "boycott_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boycott_companies"
    ADD CONSTRAINT "boycott_companies_boycott_id_fkey" FOREIGN KEY ("boycott_id") REFERENCES "public"."boycotts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boycott_companies"
    ADD CONSTRAINT "boycott_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boycott_reports"
    ADD CONSTRAINT "boycott_reports_boycott_id_fkey" FOREIGN KEY ("boycott_id") REFERENCES "public"."boycotts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boycott_reports"
    ADD CONSTRAINT "boycott_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boycott_reports"
    ADD CONSTRAINT "boycott_reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."boycott_updates"
    ADD CONSTRAINT "boycott_updates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boycott_updates"
    ADD CONSTRAINT "boycott_updates_boycott_id_fkey" FOREIGN KEY ("boycott_id") REFERENCES "public"."boycotts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boycotts"
    ADD CONSTRAINT "boycotts_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback_comments"
    ADD CONSTRAINT "feedback_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."feedback_comments"
    ADD CONSTRAINT "feedback_comments_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."follow_requests"
    ADD CONSTRAINT "follow_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."follow_requests"
    ADD CONSTRAINT "follow_requests_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plaid_items"
    ADD CONSTRAINT "plaid_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plaid_transactions"
    ADD CONSTRAINT "plaid_transactions_matched_company_id_fkey" FOREIGN KEY ("matched_company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."plaid_transactions"
    ADD CONSTRAINT "plaid_transactions_plaid_item_id_fkey" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plaid_transactions"
    ADD CONSTRAINT "plaid_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."post_likes"
    ADD CONSTRAINT "post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."post_likes"
    ADD CONSTRAINT "post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."post_media"
    ADD CONSTRAINT "post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."post_replies"
    ADD CONSTRAINT "post_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."post_replies"
    ADD CONSTRAINT "post_replies_parent_reply_id_fkey" FOREIGN KEY ("parent_reply_id") REFERENCES "public"."post_replies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."post_replies"
    ADD CONSTRAINT "post_replies_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."post_reposts"
    ADD CONSTRAINT "post_reposts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."post_reposts"
    ADD CONSTRAINT "post_reposts_repost_id_fkey" FOREIGN KEY ("repost_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."post_reposts"
    ADD CONSTRAINT "post_reposts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_boycott_id_fkey" FOREIGN KEY ("boycott_id") REFERENCES "public"."boycotts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."posts_companies"
    ADD CONSTRAINT "posts_companies_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_original_post_id_fkey" FOREIGN KEY ("original_post_id") REFERENCES "public"."posts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reply_likes"
    ADD CONSTRAINT "reply_likes_reply_id_fkey" FOREIGN KEY ("reply_id") REFERENCES "public"."post_replies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reply_likes"
    ADD CONSTRAINT "reply_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_blocks"
    ADD CONSTRAINT "user_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_blocks"
    ADD CONSTRAINT "user_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_claim_votes"
    ADD CONSTRAINT "user_claim_votes_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_companies"
    ADD CONSTRAINT "user_companies_boycott_id_fkey" FOREIGN KEY ("boycott_id") REFERENCES "public"."boycotts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_companies"
    ADD CONSTRAINT "user_companies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."user_connections"
    ADD CONSTRAINT "user_connections_boycott_id_fkey" FOREIGN KEY ("boycott_id") REFERENCES "public"."boycotts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_connections"
    ADD CONSTRAINT "user_connections_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."user_evidence"
    ADD CONSTRAINT "user_evidence_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."user_feedback"
    ADD CONSTRAINT "user_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_follows"
    ADD CONSTRAINT "user_follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_follows"
    ADD CONSTRAINT "user_follows_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can view post media" ON "public"."post_media" FOR SELECT USING (true);



CREATE POLICY "Authenticated users can add comments" ON "public"."feedback_comments" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can insert companies" ON "public"."companies" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can submit feedback" ON "public"."feedback" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can view comments" ON "public"."feedback_comments" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can view feedback" ON "public"."feedback" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authors can delete post media" ON "public"."post_media" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."posts"
  WHERE (("posts"."id" = "post_media"."post_id") AND ("posts"."author_id" = "auth"."uid"())))));



CREATE POLICY "Authors can insert post media" ON "public"."post_media" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."posts"
  WHERE (("posts"."id" = "post_media"."post_id") AND ("posts"."author_id" = "auth"."uid"())))));



CREATE POLICY "Boycott companies follow boycott visibility" ON "public"."boycott_companies" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."boycotts"
  WHERE (("boycotts"."id" = "boycott_companies"."boycott_id") AND (("boycotts"."is_public" = true) OR ("boycotts"."creator_id" = "auth"."uid"()))))));



CREATE POLICY "Companies are viewable by everyone" ON "public"."companies" FOR SELECT USING (true);



CREATE POLICY "Profiles are viewable by everyone" ON "public"."profiles" FOR SELECT USING (((NOT COALESCE("is_test_user", false)) OR (( SELECT "auth"."uid"() AS "uid") = "id")));



CREATE POLICY "Public boycotts are viewable by everyone" ON "public"."boycotts" FOR SELECT USING ((("is_public" = true) OR ("auth"."uid"() = "creator_id")));



CREATE POLICY "Submitters can update their feedback" ON "public"."feedback" FOR UPDATE USING (("auth"."uid"() = "submitted_by"));



CREATE POLICY "Target users can update follow requests" ON "public"."follow_requests" FOR UPDATE USING (("auth"."uid"() = "target_user_id"));



CREATE POLICY "User follows are viewable by everyone" ON "public"."user_follows" FOR SELECT USING (true);



CREATE POLICY "Users can add messages to own conversations" ON "public"."agent_messages" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."agent_conversations" "ac"
  WHERE (("ac"."id" = "agent_messages"."conversation_id") AND ("ac"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can adopt boycotts" ON "public"."adopted_boycotts" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create follow requests" ON "public"."follow_requests" FOR INSERT WITH CHECK (("auth"."uid"() = "requester_id"));



CREATE POLICY "Users can create own conversations" ON "public"."agent_conversations" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own boycott companies" ON "public"."boycott_companies" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."boycotts"
  WHERE (("boycotts"."id" = "boycott_companies"."boycott_id") AND ("boycotts"."creator_id" = "auth"."uid"())))));



CREATE POLICY "Users can delete own boycotts" ON "public"."boycotts" FOR DELETE USING (("auth"."uid"() = "creator_id"));



CREATE POLICY "Users can delete own follows" ON "public"."user_follows" FOR DELETE USING (("auth"."uid"() = "follower_id"));



CREATE POLICY "Users can delete own plaid_items" ON "public"."plaid_items" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own transactions" ON "public"."plaid_transactions" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own requests" ON "public"."follow_requests" FOR DELETE USING ((("auth"."uid"() = "requester_id") OR ("auth"."uid"() = "target_user_id")));



CREATE POLICY "Users can insert own boycotts" ON "public"."boycotts" FOR INSERT WITH CHECK (("auth"."uid"() = "creator_id"));



CREATE POLICY "Users can insert own feedback" ON "public"."user_feedback" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own plaid_items" ON "public"."plaid_items" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can insert own transactions" ON "public"."plaid_transactions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own boycott companies" ON "public"."boycott_companies" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."boycotts"
  WHERE (("boycotts"."id" = "boycott_companies"."boycott_id") AND ("boycotts"."creator_id" = "auth"."uid"())))));



CREATE POLICY "Users can manage own follows" ON "public"."user_follows" FOR INSERT WITH CHECK (("auth"."uid"() = "follower_id"));



CREATE POLICY "Users can unadopt boycotts" ON "public"."adopted_boycotts" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own boycotts" ON "public"."boycotts" FOR UPDATE USING (("auth"."uid"() = "creator_id"));



CREATE POLICY "Users can update own plaid_items" ON "public"."plaid_items" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own transactions" ON "public"."plaid_transactions" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own conversations" ON "public"."agent_conversations" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own adopted boycotts" ON "public"."adopted_boycotts" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own conversation messages" ON "public"."agent_messages" FOR SELECT USING (("conversation_id" IN ( SELECT "agent_conversations"."id"
   FROM "public"."agent_conversations"
  WHERE ("agent_conversations"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view own conversations" ON "public"."agent_conversations" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own plaid_items" ON "public"."plaid_items" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own transactions" ON "public"."plaid_transactions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own follow requests" ON "public"."follow_requests" FOR SELECT USING ((("auth"."uid"() = "requester_id") OR ("auth"."uid"() = "target_user_id")));



CREATE POLICY "admin_read_all" ON "public"."boycott_reports" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "admin_read_all" ON "public"."content_reports" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "admin_update_all" ON "public"."boycott_reports" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "admin_update_all" ON "public"."content_reports" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "admin_write_alternatives" ON "public"."product_alternatives" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



ALTER TABLE "public"."adopted_boycotts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "blocker_read_own" ON "public"."user_blocks" FOR SELECT USING (("blocker_id" = "auth"."uid"()));



ALTER TABLE "public"."boycott_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."boycott_companies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."boycott_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."boycott_updates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."boycotts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversation_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "delete_own_comments" ON "public"."boycott_comments" FOR DELETE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."demo_access" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."follow_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insert_own_boycott_comments" ON "public"."boycott_comments" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."boycotts"
  WHERE (("boycotts"."id" = "boycott_comments"."boycott_id") AND ("boycotts"."creator_id" = "auth"."uid"()))))));



CREATE POLICY "insert_public_boycott_comments" ON "public"."boycott_comments" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."boycotts"
  WHERE (("boycotts"."id" = "boycott_comments"."boycott_id") AND ("boycotts"."is_public" = true))))));



ALTER TABLE "public"."link_previews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "link_previews_select" ON "public"."link_previews" FOR SELECT USING (true);



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "participants_insert_messages" ON "public"."messages" FOR INSERT WITH CHECK ((("auth"."uid"() = "sender_id") AND (EXISTS ( SELECT 1
   FROM "public"."conversation_participants"
  WHERE (("conversation_participants"."conversation_id" = "messages"."conversation_id") AND ("conversation_participants"."user_id" = "auth"."uid"()))))));



CREATE POLICY "participants_read_conversations" ON "public"."conversations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."conversation_participants"
  WHERE (("conversation_participants"."conversation_id" = "conversation_participants"."id") AND ("conversation_participants"."user_id" = "auth"."uid"())))));



CREATE POLICY "participants_read_messages" ON "public"."messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."conversation_participants"
  WHERE (("conversation_participants"."conversation_id" = "messages"."conversation_id") AND ("conversation_participants"."user_id" = "auth"."uid"())))));



CREATE POLICY "participants_read_participation" ON "public"."conversation_participants" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."conversation_participants" "cp2"
  WHERE (("cp2"."conversation_id" = "cp2"."conversation_id") AND ("cp2"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."plaid_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plaid_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."post_likes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "post_likes_delete" ON "public"."post_likes" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "post_likes_insert" ON "public"."post_likes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "post_likes_select" ON "public"."post_likes" FOR SELECT USING (true);



ALTER TABLE "public"."post_media" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."post_replies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "post_replies_delete" ON "public"."post_replies" FOR DELETE USING (("auth"."uid"() = "author_id"));



CREATE POLICY "post_replies_insert" ON "public"."post_replies" FOR INSERT WITH CHECK (("auth"."uid"() = "author_id"));



CREATE POLICY "post_replies_select" ON "public"."post_replies" FOR SELECT USING (true);



ALTER TABLE "public"."post_reposts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "post_reposts_delete" ON "public"."post_reposts" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "post_reposts_insert" ON "public"."post_reposts" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "post_reposts_select" ON "public"."post_reposts" FOR SELECT USING (true);



ALTER TABLE "public"."posts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."posts_companies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "posts_companies_delete" ON "public"."posts_companies" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."posts"
  WHERE (("posts"."id" = "posts_companies"."post_id") AND ("posts"."author_id" = "auth"."uid"())))));



CREATE POLICY "posts_companies_insert" ON "public"."posts_companies" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."posts"
  WHERE (("posts"."id" = "posts_companies"."post_id") AND ("posts"."author_id" = "auth"."uid"())))));



CREATE POLICY "posts_companies_select" ON "public"."posts_companies" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."posts"
  WHERE ("posts"."id" = "posts_companies"."post_id"))));



CREATE POLICY "posts_delete" ON "public"."posts" FOR DELETE USING (("auth"."uid"() = "author_id"));



CREATE POLICY "posts_insert" ON "public"."posts" FOR INSERT WITH CHECK (("auth"."uid"() = "author_id"));



CREATE POLICY "posts_select" ON "public"."posts" FOR SELECT USING ((("audience" = 'everyone'::"text") OR ("auth"."uid"() = "author_id") OR (("audience" = 'followers'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."user_follows"
  WHERE (("user_follows"."follower_id" = "auth"."uid"()) AND ("user_follows"."following_id" = "posts"."author_id")))))));



ALTER TABLE "public"."product_alternatives" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read_active_alternatives" ON "public"."product_alternatives" FOR SELECT USING ((("sponsor_ends_at" IS NULL) OR ("sponsor_ends_at" > "now"())));



CREATE POLICY "read_own_boycott_comments" ON "public"."boycott_comments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."boycotts"
  WHERE (("boycotts"."id" = "boycott_comments"."boycott_id") AND ("boycotts"."creator_id" = "auth"."uid"())))));



CREATE POLICY "read_public_boycott_comments" ON "public"."boycott_comments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."boycotts"
  WHERE (("boycotts"."id" = "boycott_comments"."boycott_id") AND ("boycotts"."is_public" = true)))));



ALTER TABLE "public"."reply_likes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reply_likes_delete" ON "public"."reply_likes" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "reply_likes_insert" ON "public"."reply_likes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "reply_likes_select" ON "public"."reply_likes" FOR SELECT USING (true);



CREATE POLICY "reporter_insert_own" ON "public"."boycott_reports" FOR INSERT WITH CHECK (("reporter_id" = "auth"."uid"()));



CREATE POLICY "reporter_read_own" ON "public"."boycott_reports" FOR SELECT USING (("reporter_id" = "auth"."uid"()));



CREATE POLICY "reporter_read_own" ON "public"."content_reports" FOR SELECT USING (("reporter_id" = "auth"."uid"()));



CREATE POLICY "reporter_update_own" ON "public"."boycott_reports" FOR UPDATE USING (("reporter_id" = "auth"."uid"())) WITH CHECK (("reporter_id" = "auth"."uid"()));



CREATE POLICY "select_boycott_updates" ON "public"."boycott_updates" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."boycotts" "b"
  WHERE (("b"."id" = "boycott_updates"."boycott_id") AND (("b"."is_public" = true) OR ("b"."creator_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."adopted_boycotts" "ab"
          WHERE (("ab"."boycott_id" = "b"."id") AND ("ab"."user_id" = "auth"."uid"())))))))));



ALTER TABLE "public"."sheet_sync_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_blocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_claim_votes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_claim_votes_delete" ON "public"."user_claim_votes" FOR DELETE USING (("voter_id" = "auth"."uid"()));



CREATE POLICY "user_claim_votes_insert" ON "public"."user_claim_votes" FOR INSERT WITH CHECK ((("voter_id" = "auth"."uid"()) AND "public"."uc_can_view_boycott"("public"."uc_evidence_parent_boycott"("target_kind", "target_id"))));



CREATE POLICY "user_claim_votes_select" ON "public"."user_claim_votes" FOR SELECT USING ("public"."uc_can_view_boycott"("public"."uc_evidence_parent_boycott"("target_kind", "target_id")));



CREATE POLICY "user_claim_votes_update" ON "public"."user_claim_votes" FOR UPDATE USING (("voter_id" = "auth"."uid"())) WITH CHECK (("voter_id" = "auth"."uid"()));



ALTER TABLE "public"."user_companies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_companies_delete" ON "public"."user_companies" FOR DELETE USING ("public"."uc_owns_boycott"("boycott_id"));



CREATE POLICY "user_companies_insert" ON "public"."user_companies" FOR INSERT WITH CHECK (("public"."uc_owns_boycott"("boycott_id") AND ("created_by" = "auth"."uid"())));



CREATE POLICY "user_companies_select" ON "public"."user_companies" FOR SELECT USING ("public"."uc_can_view_boycott"("boycott_id"));



CREATE POLICY "user_companies_update" ON "public"."user_companies" FOR UPDATE USING ("public"."uc_owns_boycott"("boycott_id")) WITH CHECK ("public"."uc_owns_boycott"("boycott_id"));



ALTER TABLE "public"."user_connections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_connections_delete" ON "public"."user_connections" FOR DELETE USING ("public"."uc_owns_boycott"("boycott_id"));



CREATE POLICY "user_connections_insert" ON "public"."user_connections" FOR INSERT WITH CHECK (("public"."uc_owns_boycott"("boycott_id") AND ("created_by" = "auth"."uid"())));



CREATE POLICY "user_connections_select" ON "public"."user_connections" FOR SELECT USING ("public"."uc_can_view_boycott"("boycott_id"));



CREATE POLICY "user_connections_update" ON "public"."user_connections" FOR UPDATE USING ("public"."uc_owns_boycott"("boycott_id")) WITH CHECK ("public"."uc_owns_boycott"("boycott_id"));



ALTER TABLE "public"."user_evidence" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_evidence_delete" ON "public"."user_evidence" FOR DELETE USING ("public"."uc_owns_boycott"("public"."uc_evidence_parent_boycott"("attaches_kind", "attaches_id")));



CREATE POLICY "user_evidence_insert" ON "public"."user_evidence" FOR INSERT WITH CHECK (("public"."uc_owns_boycott"("public"."uc_evidence_parent_boycott"("attaches_kind", "attaches_id")) AND ("created_by" = "auth"."uid"())));



CREATE POLICY "user_evidence_select" ON "public"."user_evidence" FOR SELECT USING ("public"."uc_can_view_boycott"("public"."uc_evidence_parent_boycott"("attaches_kind", "attaches_id")));



ALTER TABLE "public"."user_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_follows" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."messages";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."accept_follow_request"("p_requester_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_follow_request"("p_requester_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_follow_request"("p_requester_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."add_boycott_comment"("p_boycott_id" "uuid", "p_content" "text", "p_label" "text", "p_media_url" "text", "p_media_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."add_boycott_comment"("p_boycott_id" "uuid", "p_content" "text", "p_label" "text", "p_media_url" "text", "p_media_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_boycott_comment"("p_boycott_id" "uuid", "p_content" "text", "p_label" "text", "p_media_url" "text", "p_media_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."add_company_to_boycott"("p_boycott_id" "uuid", "p_company_id" "text", "p_company_name" "text", "p_company_logo_url" "text", "p_block_owns" boolean, "p_block_owned_by" boolean, "p_block_suppliers" boolean, "p_block_brands" boolean, "p_block_customers" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."add_company_to_boycott"("p_boycott_id" "uuid", "p_company_id" "text", "p_company_name" "text", "p_company_logo_url" "text", "p_block_owns" boolean, "p_block_owned_by" boolean, "p_block_suppliers" boolean, "p_block_brands" boolean, "p_block_customers" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_company_to_boycott"("p_boycott_id" "uuid", "p_company_id" "text", "p_company_name" "text", "p_company_logo_url" "text", "p_block_owns" boolean, "p_block_owned_by" boolean, "p_block_suppliers" boolean, "p_block_brands" boolean, "p_block_customers" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."adopt_boycott"("p_boycott_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."adopt_boycott"("p_boycott_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."adopt_boycott"("p_boycott_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."block_user"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."block_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."block_user"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."boycott_reports_block_moderation_edits"() TO "anon";
GRANT ALL ON FUNCTION "public"."boycott_reports_block_moderation_edits"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."boycott_reports_block_moderation_edits"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_follow_request"("p_target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_follow_request"("p_target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_follow_request"("p_target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_boycott"("p_name" character varying, "p_description" "text", "p_is_public" boolean, "p_source_links" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_boycott"("p_name" character varying, "p_description" "text", "p_is_public" boolean, "p_source_links" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_boycott"("p_name" character varying, "p_description" "text", "p_is_public" boolean, "p_source_links" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_boycott_update"("p_boycott_id" "uuid", "p_summary" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_boycott_update"("p_boycott_id" "uuid", "p_summary" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_boycott_update"("p_boycott_id" "uuid", "p_summary" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_post"("p_content" "text", "p_post_type" "text", "p_boycott_id" "uuid", "p_original_post_id" "uuid", "p_media_url" "text", "p_media_type" "text", "p_link_url" "text", "p_media_urls" "jsonb", "p_audience" "text", "p_company_mentions" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_post"("p_content" "text", "p_post_type" "text", "p_boycott_id" "uuid", "p_original_post_id" "uuid", "p_media_url" "text", "p_media_type" "text", "p_link_url" "text", "p_media_urls" "jsonb", "p_audience" "text", "p_company_mentions" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_post"("p_content" "text", "p_post_type" "text", "p_boycott_id" "uuid", "p_original_post_id" "uuid", "p_media_url" "text", "p_media_type" "text", "p_link_url" "text", "p_media_urls" "jsonb", "p_audience" "text", "p_company_mentions" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_reply"("p_post_id" "uuid", "p_content" "text", "p_parent_reply_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_reply"("p_post_id" "uuid", "p_content" "text", "p_parent_reply_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_reply"("p_post_id" "uuid", "p_content" "text", "p_parent_reply_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_boycott"("p_boycott_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_boycott"("p_boycott_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_boycott"("p_boycott_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_boycott_comment"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_boycott_comment"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_boycott_comment"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_post"("p_post_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_post"("p_post_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_post"("p_post_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_role_change_is_privileged"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_role_change_is_privileged"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_role_change_is_privileged"() TO "service_role";



GRANT ALL ON FUNCTION "public"."follow_user"("p_following_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."follow_user"("p_following_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."follow_user"("p_following_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_companies_with_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_companies_with_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_companies_with_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_connections"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_connections"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_connections"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_connections_with_details"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_connections_with_details"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_connections_with_details"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_feedback"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_feedback"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_feedback"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_alternatives_for_company"("p_target_company_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_alternatives_for_company"("p_target_company_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_alternatives_for_company"("p_target_company_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_blocked_users"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_blocked_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_blocked_users"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_boycott_comments"("p_boycott_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_boycott_comments"("p_boycott_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_boycott_comments"("p_boycott_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_boycott_for_share"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_boycott_for_share"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_boycott_for_share"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_boycotts_for_company"("p_company_identifier" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_boycotts_for_company"("p_company_identifier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_boycotts_for_company"("p_company_identifier" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_company"("p_company_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_company"("p_company_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_company"("p_company_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_company_connections_by_type"("p_company_id" "uuid", "p_relationship_type" "text", "p_direction" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_company_connections_by_type"("p_company_id" "uuid", "p_relationship_type" "text", "p_direction" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_company_connections_by_type"("p_company_id" "uuid", "p_relationship_type" "text", "p_direction" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_company_incoming_connections"("p_company_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_company_incoming_connections"("p_company_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_company_incoming_connections"("p_company_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_company_outgoing_connections"("p_company_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_company_outgoing_connections"("p_company_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_company_outgoing_connections"("p_company_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_connection_source_count"("p_connection_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_connection_source_count"("p_connection_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_connection_source_count"("p_connection_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_connection_sources"("p_connection_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_connection_sources"("p_connection_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_connection_sources"("p_connection_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_conversations"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_conversations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_conversations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_email_by_username"("p_username" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_email_by_username"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_email_by_username"("p_username" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_feed"("p_cursor" timestamp with time zone, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_feed"("p_cursor" timestamp with time zone, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_feed"("p_cursor" timestamp with time zone, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_feed_unread_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_feed_unread_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_feed_unread_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_followed_boycotts"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_followed_boycotts"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_followed_boycotts"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_follower_count"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_follower_count"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_follower_count"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_followers"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_followers"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_followers"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_following"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_following"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_following"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_following_count"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_following_count"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_following_count"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_following_with_profiles"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_following_with_profiles"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_following_with_profiles"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_incoming_follow_requests"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_incoming_follow_requests"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_incoming_follow_requests"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_messages"("p_conversation_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_messages"("p_conversation_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_messages"("p_conversation_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_boycotts"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_boycotts"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_boycotts"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_followed_updates"("p_cursor" timestamp with time zone, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_followed_updates"("p_cursor" timestamp with time zone, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_followed_updates"("p_cursor" timestamp with time zone, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_or_create_conversation"("p_other_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_or_create_conversation"("p_other_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_or_create_conversation"("p_other_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_outgoing_follow_requests"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_outgoing_follow_requests"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_outgoing_follow_requests"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_post"("p_post_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_post"("p_post_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_post"("p_post_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_post_for_share"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_post_for_share"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_post_for_share"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_post_replies"("p_post_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_post_replies"("p_post_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_post_replies"("p_post_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_profile"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_profile"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_profile"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_profiles_by_ids"("p_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_profiles_by_ids"("p_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_profiles_by_ids"("p_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_boycotts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_boycotts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_boycotts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_spending_by_company"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_spending_by_company"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_spending_by_company"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_spending_over_time"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_group_by" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_spending_over_time"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_group_by" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_spending_over_time"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_group_by" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_spending_stats"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_spending_stats"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_spending_stats"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_boycotted_companies"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_boycotted_companies"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_boycotted_companies"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_boycotts_for_company"("p_company_identifier" "text", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_boycotts_for_company"("p_company_identifier" "text", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_boycotts_for_company"("p_company_identifier" "text", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_plaid_items"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_plaid_items"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_plaid_items"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_posts"("p_user_id" "uuid", "p_cursor" timestamp with time zone, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_posts"("p_user_id" "uuid", "p_cursor" timestamp with time zone, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_posts"("p_user_id" "uuid", "p_cursor" timestamp with time zone, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_transactions"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_transactions"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_transactions"("p_user_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_users_by_followers"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_users_by_followers"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_users_by_followers"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_connection_source"("p_connection_id" "uuid", "p_source_url" "text", "p_source_title" "text", "p_source_type" character varying, "p_source_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."insert_connection_source"("p_connection_id" "uuid", "p_source_url" "text", "p_source_title" "text", "p_source_type" character varying, "p_source_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_connection_source"("p_connection_id" "uuid", "p_source_url" "text", "p_source_title" "text", "p_source_type" character varying, "p_source_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_blocked"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_blocked"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_blocked"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_following"("p_follower_id" "uuid", "p_following_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_following"("p_follower_id" "uuid", "p_following_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_following"("p_follower_id" "uuid", "p_following_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."like_post"("p_post_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."like_post"("p_post_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."like_post"("p_post_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."like_reply"("p_reply_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."like_reply"("p_reply_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."like_reply"("p_reply_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_feed_read"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_feed_read"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_feed_read"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reject_follow_request"("p_requester_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reject_follow_request"("p_requester_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_follow_request"("p_requester_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."remove_company_from_boycott"("p_boycott_id" "uuid", "p_company_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."remove_company_from_boycott"("p_boycott_id" "uuid", "p_company_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_company_from_boycott"("p_boycott_id" "uuid", "p_company_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_boycott"("p_boycott_id" "uuid", "p_reason" "text", "p_details" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_boycott"("p_boycott_id" "uuid", "p_reason" "text", "p_details" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."report_boycott"("p_boycott_id" "uuid", "p_reason" "text", "p_details" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_boycott"("p_boycott_id" "uuid", "p_reason" "text", "p_details" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_content"("p_content_type" "text", "p_content_id" "uuid", "p_reason" "text", "p_details" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_content"("p_content_type" "text", "p_content_id" "uuid", "p_reason" "text", "p_details" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_content"("p_content_type" "text", "p_content_id" "uuid", "p_reason" "text", "p_details" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."repost_post"("p_post_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."repost_post"("p_post_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."repost_post"("p_post_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_company_id"("p_identifier" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_company_id"("p_identifier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_company_id"("p_identifier" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."search_companies"("p_query" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_companies"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_companies"("p_query" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_users"("p_query" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_users"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_users"("p_query" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."send_follow_request"("p_target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."send_follow_request"("p_target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_follow_request"("p_target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."send_message"("p_conversation_id" "uuid", "p_content" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."send_message"("p_conversation_id" "uuid", "p_content" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_message"("p_conversation_id" "uuid", "p_content" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_user_role"("p_user_id" "uuid", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_user_role"("p_user_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_user_role"("p_user_id" "uuid", "p_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."uc_can_view_boycott"("b_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."uc_can_view_boycott"("b_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."uc_can_view_boycott"("b_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."uc_cascade_user_company_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."uc_cascade_user_company_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."uc_cascade_user_company_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."uc_cascade_user_connection_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."uc_cascade_user_connection_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."uc_cascade_user_connection_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."uc_evidence_parent_boycott"("parent_kind" "text", "parent_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."uc_evidence_parent_boycott"("parent_kind" "text", "parent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."uc_evidence_parent_boycott"("parent_kind" "text", "parent_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."uc_owns_boycott"("b_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."uc_owns_boycott"("b_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."uc_owns_boycott"("b_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."unadopt_boycott"("p_boycott_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."unadopt_boycott"("p_boycott_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unadopt_boycott"("p_boycott_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."unblock_user"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unblock_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unblock_user"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."unfollow_user"("p_following_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."unfollow_user"("p_following_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unfollow_user"("p_following_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."unlike_post"("p_post_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."unlike_post"("p_post_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unlike_post"("p_post_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."unlike_reply"("p_reply_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."unlike_reply"("p_reply_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unlike_reply"("p_reply_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."unrepost_post"("p_post_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."unrepost_post"("p_post_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unrepost_post"("p_post_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_agent_conversation_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_agent_conversation_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_agent_conversation_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_boycott"("boycott_id" "uuid", "new_name" "text", "new_description" "text", "new_is_public" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."update_boycott"("boycott_id" "uuid", "new_name" "text", "new_description" "text", "new_is_public" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_boycott"("boycott_id" "uuid", "new_name" "text", "new_description" "text", "new_is_public" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_boycott"("p_boycott_id" "uuid", "p_name" character varying, "p_description" "text", "p_is_public" boolean, "p_source_links" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_boycott"("p_boycott_id" "uuid", "p_name" character varying, "p_description" "text", "p_is_public" boolean, "p_source_links" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_boycott"("p_boycott_id" "uuid", "p_name" character varying, "p_description" "text", "p_is_public" boolean, "p_source_links" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_boycott_company"("p_boycott_id" "uuid", "p_company_id" "text", "p_block_owns" boolean, "p_block_owned_by" boolean, "p_block_suppliers" boolean, "p_block_brands" boolean, "p_block_customers" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."update_boycott_company"("p_boycott_id" "uuid", "p_company_id" "text", "p_block_owns" boolean, "p_block_owned_by" boolean, "p_block_suppliers" boolean, "p_block_brands" boolean, "p_block_customers" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_boycott_company"("p_boycott_id" "uuid", "p_company_id" "text", "p_block_owns" boolean, "p_block_owned_by" boolean, "p_block_suppliers" boolean, "p_block_brands" boolean, "p_block_customers" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_demo_access_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_demo_access_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_demo_access_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_feedback_status"("feedback_id" "uuid", "new_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_feedback_status"("feedback_id" "uuid", "new_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_feedback_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_feedback_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_feedback_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_full_profile"("p_username" "text", "p_display_name" "text", "p_bio" "text", "p_profile_picture_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_full_profile"("p_username" "text", "p_display_name" "text", "p_bio" "text", "p_profile_picture_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_full_profile"("p_username" "text", "p_display_name" "text", "p_bio" "text", "p_profile_picture_url" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_profile_display_name"("user_id" "uuid", "new_display_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_profile_display_name"("user_id" "uuid", "new_display_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_profile_display_name"("user_id" "uuid", "new_display_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_profile_picture"("user_id" "uuid", "new_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_profile_picture"("user_id" "uuid", "new_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_profile_picture"("user_id" "uuid", "new_url" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_profile_privacy"("user_id" "uuid", "new_privacy" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."update_profile_privacy"("user_id" "uuid", "new_privacy" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_profile_privacy"("user_id" "uuid", "new_privacy" boolean) TO "service_role";
























GRANT ALL ON TABLE "public"."adopted_boycotts" TO "anon";
GRANT ALL ON TABLE "public"."adopted_boycotts" TO "authenticated";
GRANT ALL ON TABLE "public"."adopted_boycotts" TO "service_role";



GRANT ALL ON TABLE "public"."agent_conversations" TO "anon";
GRANT ALL ON TABLE "public"."agent_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_conversations" TO "service_role";



GRANT ALL ON TABLE "public"."agent_messages" TO "anon";
GRANT ALL ON TABLE "public"."agent_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_messages" TO "service_role";



GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT ALL ON TABLE "public"."boycott_comments" TO "anon";
GRANT ALL ON TABLE "public"."boycott_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."boycott_comments" TO "service_role";



GRANT ALL ON TABLE "public"."boycott_companies" TO "anon";
GRANT ALL ON TABLE "public"."boycott_companies" TO "authenticated";
GRANT ALL ON TABLE "public"."boycott_companies" TO "service_role";



GRANT ALL ON TABLE "public"."boycott_reports" TO "anon";
GRANT ALL ON TABLE "public"."boycott_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."boycott_reports" TO "service_role";



GRANT ALL ON TABLE "public"."boycott_updates" TO "anon";
GRANT ALL ON TABLE "public"."boycott_updates" TO "authenticated";
GRANT ALL ON TABLE "public"."boycott_updates" TO "service_role";



GRANT ALL ON TABLE "public"."boycotts" TO "anon";
GRANT ALL ON TABLE "public"."boycotts" TO "authenticated";
GRANT ALL ON TABLE "public"."boycotts" TO "service_role";



GRANT ALL ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT ALL ON TABLE "public"."content_reports" TO "anon";
GRANT ALL ON TABLE "public"."content_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."content_reports" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_participants" TO "anon";
GRANT ALL ON TABLE "public"."conversation_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_participants" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."demo_access" TO "anon";
GRANT ALL ON TABLE "public"."demo_access" TO "authenticated";
GRANT ALL ON TABLE "public"."demo_access" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON TABLE "public"."feedback_comments" TO "anon";
GRANT ALL ON TABLE "public"."feedback_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback_comments" TO "service_role";



GRANT ALL ON TABLE "public"."follow_requests" TO "anon";
GRANT ALL ON TABLE "public"."follow_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."follow_requests" TO "service_role";



GRANT ALL ON TABLE "public"."link_previews" TO "anon";
GRANT ALL ON TABLE "public"."link_previews" TO "authenticated";
GRANT ALL ON TABLE "public"."link_previews" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."plaid_items" TO "anon";
GRANT ALL ON TABLE "public"."plaid_items" TO "authenticated";
GRANT ALL ON TABLE "public"."plaid_items" TO "service_role";



GRANT ALL ON TABLE "public"."plaid_transactions" TO "anon";
GRANT ALL ON TABLE "public"."plaid_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."plaid_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."post_likes" TO "anon";
GRANT ALL ON TABLE "public"."post_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."post_likes" TO "service_role";



GRANT ALL ON TABLE "public"."post_media" TO "anon";
GRANT ALL ON TABLE "public"."post_media" TO "authenticated";
GRANT ALL ON TABLE "public"."post_media" TO "service_role";



GRANT ALL ON TABLE "public"."post_replies" TO "anon";
GRANT ALL ON TABLE "public"."post_replies" TO "authenticated";
GRANT ALL ON TABLE "public"."post_replies" TO "service_role";



GRANT ALL ON TABLE "public"."post_reposts" TO "anon";
GRANT ALL ON TABLE "public"."post_reposts" TO "authenticated";
GRANT ALL ON TABLE "public"."post_reposts" TO "service_role";



GRANT ALL ON TABLE "public"."posts" TO "anon";
GRANT ALL ON TABLE "public"."posts" TO "authenticated";
GRANT ALL ON TABLE "public"."posts" TO "service_role";



GRANT ALL ON TABLE "public"."posts_companies" TO "anon";
GRANT ALL ON TABLE "public"."posts_companies" TO "authenticated";
GRANT ALL ON TABLE "public"."posts_companies" TO "service_role";



GRANT ALL ON SEQUENCE "public"."posts_companies_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."posts_companies_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."posts_companies_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."product_alternatives" TO "anon";
GRANT ALL ON TABLE "public"."product_alternatives" TO "authenticated";
GRANT ALL ON TABLE "public"."product_alternatives" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."reply_likes" TO "anon";
GRANT ALL ON TABLE "public"."reply_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."reply_likes" TO "service_role";



GRANT ALL ON TABLE "public"."sheet_sync_state" TO "anon";
GRANT ALL ON TABLE "public"."sheet_sync_state" TO "authenticated";
GRANT ALL ON TABLE "public"."sheet_sync_state" TO "service_role";



GRANT ALL ON TABLE "public"."user_blocks" TO "anon";
GRANT ALL ON TABLE "public"."user_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."user_blocks" TO "service_role";



GRANT ALL ON TABLE "public"."user_claim_votes" TO "anon";
GRANT ALL ON TABLE "public"."user_claim_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."user_claim_votes" TO "service_role";



GRANT ALL ON TABLE "public"."user_companies" TO "anon";
GRANT ALL ON TABLE "public"."user_companies" TO "authenticated";
GRANT ALL ON TABLE "public"."user_companies" TO "service_role";



GRANT ALL ON TABLE "public"."user_connections" TO "anon";
GRANT ALL ON TABLE "public"."user_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."user_connections" TO "service_role";



GRANT ALL ON TABLE "public"."user_evidence" TO "anon";
GRANT ALL ON TABLE "public"."user_evidence" TO "authenticated";
GRANT ALL ON TABLE "public"."user_evidence" TO "service_role";



GRANT ALL ON TABLE "public"."user_feedback" TO "anon";
GRANT ALL ON TABLE "public"."user_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."user_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."user_follows" TO "anon";
GRANT ALL ON TABLE "public"."user_follows" TO "authenticated";
GRANT ALL ON TABLE "public"."user_follows" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

































-- A fresh Supabase database grants EXECUTE on every new public function to
-- anon through its default privileges. Production revoked it from these; a
-- schema dump records grants that exist, not ones that were removed, so the
-- revocations must be explicit or a rebuilt database lets signed-out callers
-- run them.
REVOKE ALL ON FUNCTION "public"."block_user"("p_user_id" "uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."get_blocked_users"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."is_blocked"("p_user_id" "uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."report_content"("p_content_type" "text", "p_content_id" "uuid", "p_reason" "text", "p_details" "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."set_user_role"("p_user_id" "uuid", "p_role" "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."unblock_user"("p_user_id" "uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."update_feedback_status"("feedback_id" "uuid", "new_status" "text") FROM "anon";


-- `supabase db dump` skips Supabase-managed schemas, so this trigger on
-- auth.users was missing: signups would succeed and never get a profile.
CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users"
  FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();
