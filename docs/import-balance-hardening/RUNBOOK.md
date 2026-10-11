# Воспроизведение и staging-приёмка

## Версии и применение

Этот incremental patch применяется **только** к tree `7da5352d81f1a889fa1e0e7b5bf7d92b6274ce6d`: исторический cloud candidate `265cfa8419dee9508e64ebf4a6a81c05a593a121`, ветка fix/import-balance-integration. Полный исходный cumulative patch имеет базу main `fb03df57c0cb7f89e45d879c2d4c635359a45408`. Выберите один способ восстановления: candidate archive либо cumulative patch на его правильной базе. Не применяйте вместе constituent patches и cumulative patch.

В этой Windows-сессии кандидат восстановлен из проверенных bytes/manifest и Git archive в отдельный checkout. Его локальный synthetic baseline commit `fb26b0735d85f31e6ee4339706ffa5a8b2fe3300` имеет тот же tree, но **не является** историческим cloud commit. Новая локальная ветка fix/financial-writer-contracts. Итоговые HEAD/tree, incremental SHA и clean-apply proof находятся в VERSION.json и CLEAN_APPLY.json пакета. Remote main при первоначальной проверке был указанной базой; это не бессрочное подтверждение отсутствия изменений remote.

До установки зависимостей и после применения:

```sh
git rev-parse 'HEAD^{tree}'
git apply --check CFO_AI_Financial_Writer_Hardening.patch
git apply --index CFO_AI_Financial_Writer_Hardening.patch
git write-tree
git diff --cached --check
```

Итоговый write-tree должен совпасть с VERSION.json. Пакет содержит полный canonical source archive, не node_modules, тестовые PG data или реальные финансовые данные. MANIFEST.sha256 не включает собственный файл.

## Зависимости и обычные проверки

Node20.20.2 и Node22.23.3 проверены локально. Client lockfile не изменён. Root package/lockfile добавляют только pinned `ws@8.22.0`: настоящий Supabase SDK без mock падал при старте Node20 из-за отсутствующего native WebSocket. Backend передаёт transport лишь при отсутствии native constructor; Node22 сохраняет native path. Старые dependency versions не обновлены.

Основание explicit transport: [Supabase runtime change](https://github.com/orgs/supabase/discussions/37869). Это проверенная совместимость текущего locked SDK, не обещание vendor support Node20 для будущих обновлений: [Supabase прекращение поддержки Node20](https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20). Переход CI/deployment на поддерживаемую Node версию — отдельное решение, в этом задании runtime settings не менялись. Скрипт cleanupOrphanDocuments имеет собственный createClient и не квалифицирован этим запуском server.

```sh
npm ci
npm ci --prefix client
npm install --prefix ../test-runtime --no-save --package-lock=false react@18.3.1 react-test-renderer@18.3.1
```

Для V2 установите `REACT_TEST_RENDERER_PATH` в абсолютный каталог ../test-runtime/node_modules/react-test-renderer. `V2_SCOPE_TEST_ROOT` должен указывать **на repo root**, а не каталог тестовых зависимостей; на Windows используйте `/` в этом пути. V2 runner наследует эти переменные. Для локальных сборок используйте настоящий флаг `VITE_DESIGN_V2=false` / `true`.

```sh
node --test --test-reporter=tap tests/financialApiOutcome.test.mjs
VITE_DESIGN_V2=false node client/node_modules/vite/bin/vite.js build client
VITE_DESIGN_V2=true node client/node_modules/vite/bin/vite.js build client
```

В PowerShell задавайте переменные через `$env:NAME='value'`; приведённые shell env assignments нужно адаптировать. Полные фактически выполненные команды находятся в VERIFICATION.json. Повторить на обеих Node версиях, включая полный real-PG audit ниже.

## Настоящий PostgreSQL

Только **выделенный disposable локальный cluster**, loopback URL. Admin test user должен иметь CREATE DATABASE/CREATE ROLE; это не production/staging credentials. Runner создаёт fresh базы и тестовые роли, drop касается только созданных тестовых баз. Не направлять его на реальный проект, даже если там разрешено чтение.

```sh
DATABASE_URL=postgresql://TEST_ADMIN@127.0.0.1:TEST_PORT/postgres \
  node tests/integration/runImportBalanceAudit.cjs ../audit-node22
```

Повторить Node20 и Node22 в разные каталоги. Runner отказывает при не-loopback URL; недоступный PG даёт exit=1 и environment-blocker.json, не зелёный skip. `HF_REQUIRE_FULL_CHECKS=1` и `HF_EMBEDDED_SQL=0` установлены runner. Не убирать skip/error detection ради зелёного результата.

Наборы: совместные 31 SQL/11 HTTP; исходные balance26/import24/restrict14; новые writer-contracts18 и races12; client outcome7; V2 57; financial44; load20 trials. Числа — ожидаемый состав, при изменении тестов проверять фактический TAP. Старый standalone businessIsolation script раньше молча пропускал исполнение: его **16 исходных assertions** теперь выполняются внутри writer-contracts на полной disposable schema, отдельный скрытый skip исключён. Не складывать 16 asserts и 18 TAP cases как независимые suite counts.

Все новые SQL/HTTP/race/load базы используют полный snapshot `tests/fixtures/schema/prod_public_schema_2026-10-08.sql` + заданные миграции. Из исходного balance26 первые25 сохраняют legacy минимальную schema как отдельную compatibility-квалификацию; последний HTTP case перенесён на полный integrated fixture. Этот факт не скрывать. Старые mocks/PGlite unit suites также не выдавать за full PG schema acceptance.

Гонки используют независимые connections и наблюдаемый `pg_blocking_pids` barrier. Нужны проверки реальных RPC/HTTP путей, а не только privileged inversion. Diagnostic wallet-first SQL специально вне supported protocol; 40P01 там не равен public endpoint bug. Не считать подготовленные тесты исполненными.

На текущем Windows host локальный PG17.11 запускался и объявлял ready, но client connect не завершался/ETIMEDOUT, один native host запуск дал socket10013. Причина **не установлена**; firewall/access/cache не менялись. Локальные тестовые PG servers остановлены. После устранения окружения начать с connect/SELECT1 и полного audit, не повторять бесконечно старты приложения.

### Ограниченный SQL smoke

```sh
HF_EMBEDDED_SQL=1 node --test --test-reporter=tap tests/integration/financialWriterContracts.test.js
```

Выполнено на Node20/22, 18 pass, 0 fail, 0 skip. Движок PGlite сообщает **PostgreSQL18.3**; single connection SQL + настоящий локальный Express с SQL adapter. Это проверяет тела функций, rollback и HTTP contract, **не PG17 sessions, PostgREST/JWT/RLS/cache или load**. Personal flag включён только внутри тестового процесса для synthetic boundary/error assertions; реальные flags не менялись.

## Нагрузка

`importBalanceLoad.cjs` запускает пять режимов на N=1/5/20/50: independent, mixed import/manual/PATCH, long A + independent B, Personal+Business, metadata+money. Каждый trial fresh full DB. Personal режим использует один shared Personal wallet этого владельца и независимые Business wallets; schema запрещает несколько Personal workspaces одного owner. Raw JSON включает timings, gate roundtrip samples, dataset sizes, throughput/percentiles/errors и конечные balance/provenance checks. Gate roundtrip включает network/execute overhead: это не чистая server wait-event duration. Metadata режим при N=1 не создаёт параллельного money consumer; параллельность появляется с N>=5. Контролируемый long import использует 500 rows и synthetic per-row delay, это не production workload forecast.

```sh
DATABASE_URL=postgresql://TEST_ADMIN@127.0.0.1:TEST_PORT/postgres \
  node tests/integration/importBalanceLoad.cjs ../load-results.json
```

Текущий LOAD_RESULTS.json содержит **blocked/not_run**, без придуманных p95/throughput. Предыдущие результаты относятся к старому candidate PG16/Node22; новый gate охватывает дополнительные parents/metadata и его overhead неизвестен. Недействительный прежний XX000 beyond EOF исключён; причина не объявляется установленной. Gate сохранён, capacity/redesign — отдельный release blocker.

## Schema и staging

Не выполнять blind `supabase db push`: здесь смешаны legacy numeric и timestamp filenames, а live history неполна. Локальный правильный порядок после authoritative Oct8 base:

1. 069_bank_import_atomic_confirm.sql;
2. 070_atomic_business_balance.sql;
3. 071_financial_records_restrict_user_delete.sql;
4. 20261010143341_import_balance_compat.sql;
5. **20261011001823_financial_writer_protocol.sql**.

Старые миграции не изменены. Новая migration транзакционная и предназначена для применения **один раз**; повтор CREATE объектов не idempotent. Она prefixes только явно перечисленные present RPCs через pg_get_functiondef, сохраняя signatures/security/grants. Если позже устанавливаются dark037–039 RPCs/tables, отдельная новая migration обязана добавить тот же gate-first prefix/triggers. Не переустанавливать весь legacy каталог для исправления отсутствующего RPC.

Read-only live catalog проверен: PG17.6, девять таблиц/217 колонок и 11 базовых functions. Две serial defaults имеют только отличие schema qualification; шесть function definitions MD5 одинаковы, девять source hashes одинаковы; два payment/transfer тела различаются comments, executable lines совпадают. Это **subset parity**, не полный schema/RLS/staging proof. История возвращает десять записей057–064, хотя066/067 RPCs есть; новые069–071/compat/writer RPCs не обнаружены. Сопоставить историю, schema dump и definitions до планирования apply. Файлы production-rpc-reference.sql — read-only evidence, **не deployment migration**.

Для будущей staging run `tests/integration/financialWriterPreflight.sql`: BEGIN READ ONLY/ROLLBACK, catalog/grants/triggers/columns, counts duplicates/provenance/legacy currency+scope. Не чинить найденные реальные деньги автоматически. Для отсутствующих RPC сверять ожидаемый manifest/список функций, отсутствие строк в query не означает pass.

После отдельно разрешённого staging schema apply: проверить grants и role boundary; согласованный reload PostgREST schema cache владельцем staging; проверить наличие всех guarded RPC без fallback; только потом совместимый backend/client и HTTP acceptance. В данном задании внешних apply/reload/deploy не было.

Staging отдельная приёмка: реальные JWT/service-role/RLS, schema/cache mismatch, UI error/replay/reload, переключение компаний и Personal, historical import/manual/PATCH races, blocked writers, load. `SECURITY INVOKER` и grants в smoke не заменяют эту проверку.

## Повторы и восстановление

Ключи обязательны для Business pay/transfer/manual batch/wallet create/adjust. SDK/client не делает blind retry. После network/неподтверждённого 5xx сохраняет intent key; сначала refresh/status review, затем тот же key. При известном rollback повтор возможен как новое действие; не удалять неизвестный intent ради «починки». Login token change, private storage/reload, edited payload требуют отдельной сверки; полного operation-history recovery UI пока нет. Receipt replay является историческим ответом, а не гарантией текущего balance. Wallet create replay читает current wallet и отказывает, если тот удалён. Не чистить receipts автоматически при reset, не сокращать retention без отдельного reconciliation проекта.

Намеренные compatibility breaks: unkeyed pay/transfer/batch/create/adjust отказывают; legacy accounts/backfill, fake settle и unscoped platform adjustment отказывают. Текущие UI используют keyed apiFetch; backfill button ещё требует продуктового legacy review и показывает отказ. Не включать Personal/bridge dark features: unkeyed Personal money retry и funding currency/retry не закрыты.

Перед staging rehearsal сделать backup и проверить восстановление на disposable копии по отдельному утверждённому плану. При ошибке schema/backend/cache сначала остановить новые финансовые writes и сверить версии. Не снимать balance/gate/provenance guards в production ради доступности; не откатывать частично код с несовместимой schema. Safe rollback/forward-fix должен быть проверен на staging с receipts и настоящим data inventory. Production/HCI recovery здесь не выполнялось.
