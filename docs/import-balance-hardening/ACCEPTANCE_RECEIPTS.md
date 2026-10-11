# Receipt review — 11 октября 2026

Это review исходников точного baseline 7b6b1a292922f9d813b3c575c91c1a5d16af9ba6 и минимального следующего патча. Отдельные Node20/22 single-session PGlite SQL/Express smoke прошли; PostgreSQL17 concurrency и настоящий PostgREST/JWT/RLS остаются BLOCKED.

| Свойство | Код и доступная проверка | Не закрыто |
|---|---|---|
| Business create identity | financial_write_requests PK business_id/actor_user_id/operation/request_key; actor/role перед чтением; wallet_create, transaction_batch, wallet_adjust | Реальная JWT→actor связка и service-role окружение staging |
| Payload mismatch | JSONB intent сравнивается до replay; изменённый payload 409 без движения | Одна receipt доверяет серверному intent/rows. Привилегированный caller обязан передавать согласованные аргументы; не публичный SQL API |
| Атомарность | create/adjust/manual result и receipt в одной SQL transaction; opening late failure smoke | Два конкурентных connection и cancel/timeout на PG17 |
| Повтор | replay не добавляет движение; batch/adjust response исторический; create читает текущий wallet и отказывает после удаления | Исторический ответ не подтверждает текущий баланс после reset/других действий |
| Изоляция | authenticated SELECT receipts отвергнут 42501; один key для другого actor/Business/operation имеет отдельный результат; чужой Business HTTP 403 | Реальные anon/authenticated/service_role grants, RLS и PostgREST не квалифицированы адаптером |
| Lost response | HTTP adapter обрывает результат ПОСЛЕ committed SQL; restore временно снятой CFO роли + тот же key возвращает replay, ledger count1 | Browser E2E и настоящая потеря ответа через PostgREST/proxy |
| Pay/transfer | Собственные idempotency records/transfer identities и guarded RPC; обязательный stable key | Не приравнивать их к новой трёхоперационной таблице receipts; PG17 repeats/races pending |

## Исправленный клиентский дефект

До исправления последовательность commit → потеря ответа → временный 400/403/409 → reload удаляла intent key. Следующий submit мог получить новый ключ и создать вторую операцию. tests/financialApiOutcome.test.mjs воспроизводит это на пяти guarded путях и трёх кодах отказа: старый код 7 pass/1 fail, исправленный 8 pass/0 fail на Node20/22. apiFetch теперь сохраняет key до подтверждённого успеха; known rollback текущей попытки тоже не разрешает потерю прошлого неизвестного intent. Автоматического retry нет. Это fetch/storage модель, а не многосессионный database proof.

## Незавершённые пользовательские сценарии

- Изменение login token, body/date/amount или порядка JSON свойств меняет storage fingerprint; очистка storage/private mode теряет ключ после reload. Одинаковый повтор безопасен только при сохранённой identity, Business и payload.
- Если пользователь заново вручную вводит уже подтверждённую операцию после очистки intent, это новый запрос. Нет полного operation-history/status recovery UI и связи новой формы с потерянным intent.
- Утраченная роль не разрешает прочитать успех через Business API до восстановления доступа. Нужна проверяемая сверка владельцем, без обхода authorization.
- Удалённый wallet после успешного create оставляет receipt и отказ financial_intent_invalidated. Новое создание требует отдельно осознанного intent; автоматически менять key нельзя.
- Unknown outcome для unkeyed Personal/payroll/funding не закрыт этим исправлением. Не включать dark features и не обещать единый retry контракт.

## Проверка callers отключённых путей

Статический поиск tracked client/server на новом кандидате: Classic Accounts имел две кнопки POST /wallets/backfill. Обе заменены пояснением о проверке company/currency/wallet mapping; история и доступные обычные wallet операции сохранены. Старые accounts/* не имеют найденного актуального UI caller. PATCH /debts/:id/settle и unscoped /admin/wallets/:id/adjust-balance не имеют найденного UI caller. Invoice settlement и scoped Classic/V2 wallet adjustment — другие действующие пути; их не отключали. Это ограниченная repo census; внешние/старые мобильные consumers неизвестны. Backfill остаётся отдельной проверяемой процедурой, никакие исторические деньги не переносились.
