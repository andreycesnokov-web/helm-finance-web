# Отдельный scope mismatch review

11 октября read-only FK catalog и counts подтвердили одну конкретную ранее найденную запись: wallet.scope=personal, workspace.type=business, is_active=false. UUID хранится в прежнем локальном review-reference; деньги/названия/документы не экспортировались. Запись не изменена.

Все шесть фактических FK → wallets обнаружены и проверены для target: bank_import_batches.wallet_id, bank_reconciliations.wallet_id, incoming_payments.wallet_id, payment_provider_connections.linked_wallet_id (SET NULL), payroll_employees.default_wallet_id, payroll_payments.wallet_id. Для каждого count0. Physical FK transactions.wallet_id в live отсутствует: отдельный non-FK ledger count0; scoped legacy NULL-wallet/name-source count0. Receipt table в live отсутствует — receipt references NOT APPLICABLE TO CURRENT SCHEMA, не доказательство отсутствия будущих references.

Это не полный граф всех consumers. Перед metadata correction дополнительно проверить JSON/extracted document references, debt/reminder account strings, provider callbacks, внешние integration consumers, stale browser cache и новые staging tables. Caller registry Business/Personal APIs, Payroll, import/reconciliation, providers, reset/delete и onboarding нужно сопоставить с authoritative владельцем данных; display label не классифицирует деньги.

В legacy017 Personal wallets могли получить default Business из-за отсутствовавшего scope filter. Старый wallet API тоже принимал personal flag в Business. Эти причины дают гипотезы, а не подтверждённое ownership решение.

Допустимые отдельные решения после review:

1. Сохранить inactive quarantine — текущий безопасный checkpoint до authoritative mapping.
2. Если владелец подтверждает Business wallet и полный inventory не содержит связей: отдельно разрешённая audited metadata correction. Не создавать opening balance и не переписывать деньги из предположений.
3. Если это настоящая Personal запись: отдельный scoped mapping/transfer plan с проверкой caller/FK/ledger impact и approval. Не менять business_id/scope автоматически и не активировать запись.

Counts находятся в acceptance-wallet-scope-counts.json и acceptance-wallet-fk-catalog.json пакета. Нулевые counts не являются разрешением удалять, переносить или переклассифицировать запись.
