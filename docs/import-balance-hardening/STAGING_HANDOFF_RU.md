# Передача следующего этапа

Патч готов к review и запуску локальной приёмки на доступном PostgreSQL17. **Финансовая staging-приёмка ещё не закрыта; production-ready не заявляется.** База и итоговый tree сверяются по VERSION.json/CLEAN_APPLY.json. Runbook, валютная таблица и writer inventory входят в тот же incremental patch.

Исправлено: canonical isFullyPaid; явный USD/IDR wallet contract для новых платежей; gate до parent/metadata locks; защита currency/legacy name/credit-policy интерпретации; atomic wallet+opening; standalone adjustment CAS; durable create receipts и stable pay/transfer keys; controlled SQLSTATE/unknown outcome; fake settle, legacy unscoped writers и platform adjustment fail closed. Debt metadata не снижает native total ниже paid и не меняет интерпретацию оплаченной валюты. Personal error не показывает ложный delete success; его scope и financial policy не расширялись.

Получены текущие Node20/22 SQL/HTTP smoke и client outcome, V2/financial, четыре builds; точные counts/logs в VERIFICATION.json. PGlite18.3 full schema и SQL adapter не являются real-PG17/PostgREST/RLS доказательством. Подготовлены12 independent-connection race tests и пять load modes. Они пока не выполнены; отсутствующих raw timings нет.

Следующий последовательный этап:

1. Поднять рабочий disposable PG17, выполнить полный audit на Node20/22, без skips. Повторить прежние31SQL/11HTTP/26balance/24import/14restrict на текущем tree; подтвердить новые18contract/12race tests, timeout/rollback/replay и Personal boundary. Разобрать любой fail, сохраняя данные и raw logs.
2. Выполнить20 load trials (5 modes × 1/5/20/50), проверить конечные данные и gate overhead. Если shared gate мешает пилоту, отдельный redesign с полной resource map, без механического wallet-only lock.
3. Read-only staging preflight и reconciliation migration history/schema; затем отдельно разрешённая rehearsal schema/backend/cache последовательность. Настоящие JWT/PostgREST/RLS и browser acceptance обязательны.
4. Отдельно закрыть V2 expected_version UI, opening adjustment+confirm, payroll currency/batch retry, bill/invoice date round-trip и document-link. Далее security incident/definer view и HCI backup/restore на авторитетных артефактах.

Не выполнять push/PR/merge/deploy, external migrations, money cleanup, auth/flag/access changes в рамках этого handoff. sources/ и налоговый checkout не затрагивать.

Стадия проекта: Business integration candidate с локальными исправлениями, до staging financial acceptance. Оценка следующего узкого этапа: ориентировочно1–2 инженерных дня **после** получения рабочего PG17/staging окружения, если новых дефектов нет; выявленные ошибки и migration drift увеличат срок. Оценить окончание всего продукта по этому этапу нельзя: acceptance критерии и перечисленные открытые задачи ещё не закрыты.
