-- Migration 070 — Deleting a user must never delete company or financial records
-- Date: 2026-10-09. CONSTRAINT-ONLY + IDEMPOTENT + TRANSACTIONAL. No data changes.
--
-- On 2026-08-27 a manual cleanup deleted a user row; `transactions.user_id ON DELETE CASCADE`
-- (and the same on debts and payroll) silently removed 83 transactions, 14 debts and 17 payroll
-- records of a company that was still active. This migration turns every FK from `users` that
-- carries company-owned data into ON DELETE RESTRICT: deleting such a user now fails loudly, and a
-- cleanup has to reassign (or deliberately delete) those records first.
--
-- Decision per FK referencing users(id) (37 in total, catalog of 2026-10-08):
--
--   CASCADE -> RESTRICT (company / financial data; must outlive the person):
--     transactions.user_id            ledger
--     debts.user_id                   bills, invoices, receivables, payables
--     payroll_employees.user_id       payroll register
--     payroll_payments.user_id        salary payments (also reference transactions)
--     payroll_payment_items.user_id   salary lines
--     businesses.owner_user_id        deleting the owner deleted the whole company (and everything
--                                     cascading from businesses)
--     reminders.user_id               business-scoped reminders (business_id) — company data
--     accounts.user_id                legacy accounts, referenced by transactions.account_id
--     categories.user_id              legacy categories, referenced by transactions.category_id
--
--   CASCADE kept (belong to the person, must disappear with the person):
--     user_profiles, user_email_identities, user_channel_links.user_id, user_channel_state,
--     telegram_user_state, channel_link_tokens, mcp_oauth_codes, mcp_oauth_tokens (credentials of
--     a deleted person must die), onboarding_progress, onboarding_context_snapshots,
--     business_member_notification_grants.user_id, business_members.user_id (a deleted member
--     leaves the company; an OWNER is already blocked by businesses.owner_user_id).
--
--   SET NULL kept (audit "who did it" pointers): business_member_notification_grants.granted_by,
--     businesses.override_created_by, email_login_codes.consumed_by, mcp_oauth_requests.decided_by,
--     onboarding_events.user_id, payment_provider_connections.created_by,
--     payment_provider_credentials.created_by / revoked_by, user_channel_links.revoked_by.
--
--   NO ACTION kept (already block deletion): business_members.invited_by_user_id, support_*.
--
-- RESTRICT (not NO ACTION): checked immediately, cannot be deferred or bypassed by another
-- cascade path in the same statement.
--
-- Nothing in the application deletes users (checked 2026-10-09: server routes, DB functions,
-- the bot, background jobs). DELETE /api/businesses/:id deletes only EMPTY businesses and is not
-- affected; rpc_reset_business_financial deletes by business and is not affected.

BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('transactions',          'transactions_user_id_fkey',          'user_id'),
      ('debts',                 'debts_user_id_fkey',                 'user_id'),
      ('payroll_employees',     'payroll_employees_user_id_fkey',     'user_id'),
      ('payroll_payments',      'payroll_payments_user_id_fkey',      'user_id'),
      ('payroll_payment_items', 'payroll_payment_items_user_id_fkey', 'user_id'),
      ('businesses',            'businesses_owner_user_id_fkey',      'owner_user_id'),
      ('reminders',             'reminders_user_id_fkey',             'user_id'),
      ('accounts',              'accounts_user_id_fkey',              'user_id'),
      ('categories',            'categories_user_id_fkey',            'user_id')
    ) AS t(tbl, con, col)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.con AND conrelid = format('public.%I', r.tbl)::regclass
               AND confdeltype = 'r') THEN
      CONTINUE;   -- already RESTRICT (re-run)
    END IF;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.tbl, r.con);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.users(id) ON DELETE RESTRICT',
                   r.tbl, r.con, r.col);
  END LOOP;
END $$;

COMMIT;
