-- Additive correction: Supabase owner defaults can pre-grant service_role ALL.
-- An additive GRANT SELECT,INSERT alone does not remove inherited UPDATE/DELETE.
-- Preserve existing receipts and committed migration hashes; no history repair.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.bank_import_confirm_requests') IS NULL THEN RAISE EXCEPTION 'import_receipts_schema_required'; END IF;
END $$;
REVOKE ALL ON TABLE public.bank_import_confirm_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON TABLE public.bank_import_confirm_requests TO service_role;

CREATE FUNCTION public.cfo_import_receipt_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 RAISE EXCEPTION 'import_receipt_immutable: Confirmed import results are append-only';
END $$;
REVOKE ALL ON FUNCTION public.cfo_import_receipt_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER bank_import_confirm_requests_immutable BEFORE UPDATE OR DELETE
ON public.bank_import_confirm_requests FOR EACH ROW EXECUTE FUNCTION public.cfo_import_receipt_immutable();
NOTIFY pgrst,'reload schema';
COMMIT;
