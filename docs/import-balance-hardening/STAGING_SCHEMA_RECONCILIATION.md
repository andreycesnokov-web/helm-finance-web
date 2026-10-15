# Полная read-only schema/history reconciliation

Отдельный staging target не предоставлен. Ни миграции, ни reload cache, ни deployment этим заданием не выполняются. Доступная новая проверка production ограничена FK metadata и counts одной ранее найденной записи. Старый subset parity не заменяет полную сверку.

## Inventory без изменения внешней базы

На отдельно разрешённом read-only соединении выполнить:

```sh
READONLY_CATALOG_URL="$AUTHORIZED_READ_ONLY_URL" node tests/integration/captureStagingSchema.cjs target-catalog.json
```

Не указывать пароль в истории shell; получать URL из разрешённого environment/secret manager. Capture использует BEGIN READ ONLY, statement_timeout20s/lock_timeout1s и ROLLBACK. Экспортирует полный набор доступных объектов public/auth/storage/supabase_migrations: relations/RLS/ACL/partition fingerprints, columns/defaults/identity, constraints/FK/actions, routines/signatures/security/owners/body hashes/config hashes, triggers, indexes, policies/role names, views/options, schemas/default ACL, critical role memberships, sequences, enums/domains, extensions и все доступные migration history rows. Не выводит деньги, документы, пароли, function bodies, trigger args, policy expressions или GUC values. Хэши definitions — fingerprint для review, не криптографическая подпись. Отсутствующая история = absent_not_verified. Permission/schema error — отказ capture, не пустой successful inventory. Скрипт SQL проверен только на full-public single-session fixture; внешняя capture не выполнена.

## Сверка трёх состояний

1. Получить authoritative baseline всех необходимых схем и историю у владельца target. Repo Oct8 fixture покрывает public; он не является authoritative dump auth/storage. Без этих материалов полная parity BLOCKED.
2. Зафиксировать candidate HEAD/tree, исходный manifest, server/client lockfiles. Сохранить исходный target inventory до любых решений об apply. Список миграций должен содержать version, файл, hash, фактический объект и источник решения.
3. На свежем disposable PG17 загрузить authoritative baseline и применить только согласованный missing suffix. Repo известный порядок после Oct8 public: 069,070,071,20261010143341,20261011001823. Legacy numeric и timestamp версии не сортировать/переприменять вслепую. В новом acceptance патче SQL migrations отсутствуют; исходные пять сохранены.
4. Capture baseline, projected candidate и target одинаковым скриптом на одинаковой major версии. Сопоставить category + schema/name/table/signature; сортировать наборы. Runtime metadata не объект schema. Расхождения owner, schema qualification, ACL, default_acl, policies, security_definer/invoker и search_path требуют отдельной объяснённой mapping таблицы; не нормализовать их до pass автоматически. Raw OID membership не сравнивается: policy/critical role names экспортированы. Проверить FK/column ordinals при любом изменении структуры.
5. Разобрать каждую missing/extra/changed routine, constraint, trigger, policy, extension и grant. Definition hash drift требует разрешённого локального просмотра полного definition, без публикации embedded secrets. Не считать совпавшие comments/body fragments полной parity. При нетипичных objects (range types, custom operators/collations, foreign tables, event triggers, publication/subscriptions, Storage buckets, Auth settings) получить дополнительный authoritative metadata inventory: capture не подтверждает такие конфигурации.
6. История10 legacy rows и реально существующие более поздние RPC уже расходились в предыдущем отчёте; повторно сверить актуальный target. Отсутствующие guarded RPC/receipts/bank_import_row_id не объявлять безопасно применёнными. Не делать history repair/stamp без отдельного owner-approved плана; не запускать blind supabase db push.

## Обязательная следующая приёмка

После отдельного разрешённого staging rollout: schema/hash parity и отсутствие fallback; согласованный владельцем reload PostgREST cache; реальные anon/authenticated/service_role JWT, revoked roles, cross-company/Personal isolation, receipt SELECT/execute grants, definer views и audit/access incident review. HTTP тестовый SQL adapter не проверяет настоящий PostgREST.

Browser: Classic/V2 lost response→same key→reload/replay; temporary403 и восстановление роли; двойной submit; stale expected_version; переключение company/Personal и abort старого запроса; открытие legacy Accounts без неработающей backfill кнопки; matching/wrong wallet currencies; import historical/manual/provenance/rollback/reconfirm; opening adjustment до confirm; wallet archive/delete после receipt; disabled settle/admin paths с понятным refusal. Проверить actual UI error presentation и восстановление состояния, а не только JSON contracts.

Перед staging test writes — отдельная disposable база/данные и проверенный backup/restore plan. Production/HCI restoration остаётся отдельным backlog, в данном этапе не выполняется.
