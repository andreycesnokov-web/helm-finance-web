# Валютный контракт платежа

Область: Business. Personal не становится Business вследствие выбора валюты, названия счёта или роли пользователя.

| Сценарий | Принятый контракт | Основание и проверка | Исправление |
|---|---|---|---|
| №6, частичная оплата USD | `isFullyPaid=false`, `is_settled=false`, `settled_at=null`; native payment 400 USD из USD wallet, остаток 600 USD | SQL RPC возвращает camelCase `isFullyPaid`. Исходный HTTP handler читал snake_case; старый memory adapter скрывал расхождение. Реальный SQL/HTTP smoke на исходном server воспроизвёл undefined вместо false | Handler читает canonical camelCase с совместимостью старого cached snake_case результата; adapter соответствует SQL. Тест проверяет native ledger, частичное/полное погашение и повтор |
| №9, legacy account без существующего wallet | `400 wallet_required`; долг, ledger и деньги неизменны. Выбор существующего USD wallet завершает платёж | Оба UI платежа выбирают wallet и сохраняют ключ; guarded balance path требует кошелёк для нового списания. Успех без кошелька противоречил этому контракту | Устаревшее ожидание заменено проверкой отказа без записи, затем успешного явного выбора и keyed replay |
| №12, unmatched account | Такой же отказ; кошелёк не угадывается по названию, currency не выводится из `$` | Legacy name может разрешаться только в однозначный wallet в выбранной Business; чужая валюта возвращает cross_currency_not_supported | Native USD не подменяется IDR; тесты проверяют неизменность долга/ledger/финансовых итогов и завершение после выбора |

Сумма долга, `paid_amount`, native movement и wallet currency имеют одну валюту. `amount_idr` служит отчётной оценкой. Поддерживаемый явный FX transfer остаётся отдельным сценарием с двумя native legs; debt payment не становится неявным FX.

Исторические NULL-wallet записи доступны для чтения. Создание нового списания требует wallet. Переименование, угадывание валюты и автоматическая привязка такой истории не выполняются. Classic DebtPaymentModal и V2 payBill используют apiFetch и wallet_id; MCP не имеет платежного tool: он создаёт pending payable draft и прикрепляет документы.

Новый платежный HTTP запрос требует стабильный idempotency_key / Idempotency-Key; перевод требует transfer_id. Для wallet create / transaction batch / standalone adjustment используется request_key. Отказ при отсутствии ключа не заменяет выбор кошелька. Проверяемый платёж, а не checkbox settle, меняет погашение; legacy /debts/:id/settle отказывает, POST debt не принимает supplied settled state.

Клиент не повторяет запрос автоматически. После неизвестного исхода он сохраняет исходный ключ для того же payload, workspace и login token; хранит только hash и ключ. Повтор с иным payload под прежним ключом отвергается. После смены login token, очистки/запрета storage или изменения payload нужно сначала сверить статус: это не универсальный offline reconciliation механизм.

Доказательства: hardening-currency-before.log, hardening-isFullyPaid-baseline.log, hardening-contract-node22.log, hardening-api-node20.log / node22.log в evidence bundle. Smoke использует PGlite PostgreSQL 18.3 и SQL adapter, не сертифицирует PG17, PostgREST, JWT/RLS или конкуренцию.
