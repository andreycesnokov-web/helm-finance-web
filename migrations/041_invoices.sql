-- ════════════════════════════════════════════════════════════════════════════
-- 041 — Invoices (Phase B). PROPOSAL — additive, NOT yet applied. Apply only after
-- approval, under the gated process (backup → apply → verify). No existing table or
-- row is modified. Rollback: DROP the tables + functions (safe pre-launch).
--
-- Decisions (locked): number INV-<business_code>-YYYY-##### (per business, PER YEAR —
-- restarts at 00001 each year); paid status is READ-THROUGH from the linked debt (not
-- stored); per-line tax_rate; drafts do NOT reserve a number (invoice_number NULL until
-- issued); invoice_counters are PRESERVED across financial reset (numbering survives).
-- ════════════════════════════════════════════════════════════════════════════

-- ── invoices ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  direction          TEXT NOT NULL CHECK (direction IN ('outgoing','incoming')),
  invoice_number     TEXT NULL,                       -- NULL until issued (drafts don't reserve)
  counterparty       TEXT NOT NULL,
  issue_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date           DATE NULL,
  currency           TEXT NOT NULL DEFAULT 'IDR',
  subtotal           NUMERIC NOT NULL DEFAULT 0 CHECK (subtotal  >= 0),   -- server-computed
  tax_total          NUMERIC NOT NULL DEFAULT 0 CHECK (tax_total >= 0),   -- server-computed
  total              NUMERIC NOT NULL DEFAULT 0 CHECK (total     >= 0),   -- server-computed
  notes              TEXT NULL,
  -- Lifecycle stored here is draft|issued|cancelled. 'paid' is DERIVED at read time
  -- from the linked debt (read-through). 'paid' is kept in the CHECK for forward-compat;
  -- the v1 API MUST NOT write 'paid' manually.
  status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','issued','paid','cancelled')),
  linked_debt_id     BIGINT NULL REFERENCES debts(id) ON DELETE SET NULL,            -- created on issue
  document_id        UUID NULL REFERENCES financial_documents(id) ON DELETE SET NULL, -- PDF later
  created_by_user_id BIGINT NULL,
  issued_at          TIMESTAMPTZ NULL,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  -- Per-business uniqueness; multiple NULLs allowed (drafts).
  UNIQUE (business_id, invoice_number),
  -- Composite-unique target so line items can enforce same-business via a composite FK.
  UNIQUE (id, business_id)
);
CREATE INDEX IF NOT EXISTS invoices_business_status_idx ON invoices(business_id, status);
CREATE INDEX IF NOT EXISTS invoices_linked_debt_idx     ON invoices(linked_debt_id);

-- updated_at maintained by trigger (no reliance on the backend remembering to set it).
CREATE OR REPLACE FUNCTION fn_invoices_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION fn_invoices_set_updated_at();

-- ── invoice_line_items ──────────────────────────────────────────────────────
-- Composite FK (invoice_id, business_id) → invoices(id, business_id) guarantees a line
-- item can NEVER point to an invoice from another business (and cascades on delete).
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID NOT NULL,
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  quantity     NUMERIC NOT NULL DEFAULT 1 CHECK (quantity   >= 0),
  unit_price   NUMERIC NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  tax_rate     NUMERIC NOT NULL DEFAULT 0 CHECK (tax_rate   >= 0),   -- percent (e.g. 11 = PPN 11%)
  line_total   NUMERIC NOT NULL DEFAULT 0 CHECK (line_total >= 0),   -- server-computed: quantity*unit_price
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  FOREIGN KEY (invoice_id, business_id) REFERENCES invoices(id, business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_idx  ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_line_items_business_idx ON invoice_line_items(business_id);

-- ── invoice_counters (per business, per year) — PRESERVED across reset ───────
CREATE TABLE IF NOT EXISTS invoice_counters (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_year INT  NOT NULL,
  last_seq    BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, period_year)
);

-- ── rpc_next_invoice_number — atomic per-business-per-year sequence ──────────
-- Returns e.g. 'INV-HF-BIZ-000004-2026-00001'. One statement → no duplicates under
-- concurrency. Called at ISSUE time only. Raises if the business does not exist; falls
-- back to a DETERMINISTIC code derived from the business id (never a generic 'BIZ').
CREATE OR REPLACE FUNCTION rpc_next_invoice_number(p_business uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_code text;
  v_year int := EXTRACT(YEAR FROM now())::int;
  v_seq  bigint;
BEGIN
  SELECT business_code INTO v_code FROM public.businesses WHERE id = p_business;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'business_not_found: %', p_business USING ERRCODE = 'no_data_found';
  END IF;
  IF v_code IS NULL OR length(btrim(v_code)) = 0 THEN
    -- deterministic, business-specific fallback (first 8 hex of the uuid)
    v_code := 'B-' || upper(substr(replace(p_business::text, '-', ''), 1, 8));
  END IF;

  INSERT INTO public.invoice_counters (business_id, period_year, last_seq)
       VALUES (p_business, v_year, 1)
  ON CONFLICT (business_id, period_year)
       DO UPDATE SET last_seq = public.invoice_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;

  RETURN 'INV-' || v_code || '-' || v_year::text || '-' || LPAD(v_seq::text, 5, '0');
END
$$;

REVOKE ALL ON FUNCTION rpc_next_invoice_number(uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION rpc_next_invoice_number(uuid) TO service_role;
  END IF;
END $$;
