-- Hand-written: guest retention of the showcase (docs/decisions/ADR-0001 D7 amendment 2026-11-20).
-- The runtime role may never delete audit events, field corrections or export rows (append-only by
-- grants, migrations 0004/0010/0012). A guest company is deleted completely after its retention period,
-- so this one function (owned by app_owner, SECURITY DEFINER) deletes all `app` rows of ONE company –
-- and only when (1) it runs inside that company's tenant context (`withTenant`, app.company_id) and
-- (2) the company is a guest company (slug `guest-…`). Forced RLS still applies inside the function
-- (app_owner is NOBYPASSRLS), so it cannot reach another company's rows either.
CREATE FUNCTION app.purge_guest_company(target uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF target IS NULL OR nullif(current_setting('app.company_id', true), '') IS DISTINCT FROM target::text THEN
    RAISE EXCEPTION 'purge_guest_company: not in the tenant context of this company' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM identity.organization o WHERE o.id = target AND o.slug LIKE 'guest-%') THEN
    RAISE EXCEPTION 'purge_guest_company: not a guest company' USING ERRCODE = '42501';
  END IF;
  DELETE FROM app.field_corrections WHERE company_id = target;
  DELETE FROM app.request_exports WHERE company_id = target;
  DELETE FROM app.extracted_fields WHERE company_id = target;
  DELETE FROM app.extraction_segments WHERE company_id = target;
  DELETE FROM app.extraction_runs WHERE company_id = target;
  DELETE FROM app.documents WHERE company_id = target;
  DELETE FROM app.requests WHERE company_id = target;
  DELETE FROM app.audit_events WHERE company_id = target;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.purge_guest_company(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.purge_guest_company(uuid) TO app_rw;
