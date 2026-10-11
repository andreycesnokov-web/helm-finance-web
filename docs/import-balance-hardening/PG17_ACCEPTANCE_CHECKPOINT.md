# PG17 acceptance checkpoint — 11 октября 2026

Полный real audit этого tree — BLOCKED, staging acceptance GO не выдан. Передавать пакет можно для review и установки изолированного тестового окружения. Готовность production/V2 не заявляется.

## Наблюдения окружения

Fresh native cluster reports/acceptance-pg17-20261011/data: postgres binary17.11, initdb успешно, отдельный PID/127.0.0.1:51129, server log ready. Raw TCP, native psql и Node pg из того же управляющего процесса не подключились (bounded ETIMEDOUT). Authentication и SQL не достигнуты; SELECT version(), два session, transaction/rollback, database create/drop NOT VERIFIED. Собственный cluster остановлен pg_ctl fast. Никакие другие службы/процессы не остановлены.

Docker Desktop screenshot показывает startup crash Inference manager/dockerInference. Windows Docker CLI не ответил за6s. Пользовательского WSL дистрибутива нет; только docker-desktop Stopped, его internals не использовались. Screenshot не устанавливает причину native PG timeout. Не выполнять factory reset, удаление volumes/cache/sockets или force kill ради этой задачи. Поддерживаемая диагностика Docker — отдельный пользовательский шаг.

После остановки собственного cluster runImportBalanceAudit на Node20.20.2/22.23.3 ожидаемо возвращает ECONNREFUSED и jobs not_run_environment_blocked (exit1). Это проверка fail-closed runner, не новая попытка запуска работающего PG и не доказательство failure SQL suites. Предыдущий same-process probe фиксирует actual запуск и ETIMEDOUT.

## Точная следующая команда в штатном другом окружении

На машине с работающим обычным Docker (не docker-desktop WSL internal), из repo root:

```sh
docker run -d --name cfo-acceptance-pg17-20261011 -e POSTGRES_USER=cfo_test -e POSTGRES_PASSWORD=cfo_disposable_only -p 127.0.0.1:55417:5432 postgres:17
docker exec cfo-acceptance-pg17-20261011 pg_isready -U cfo_test
docker image inspect postgres:17 --format '{{json .RepoDigests}}'
export DATABASE_URL='postgresql://cfo_test:cfo_disposable_only@127.0.0.1:55417/postgres'
node tests/integration/probeDisposablePg17.cjs > pg17-readiness.json
```

Нужен уникальный ещё не существующий container name/free port; пароль исключительно synthetic disposable, не внешний credential. При недоступном Docker перейти к обычному Linux/пользовательскому WSL с установленным PG17:

```sh
export PATH=/usr/lib/postgresql/17/bin:$PATH
export CFO_TEST_CLUSTER="$PWD/../cfo-acceptance-pg17-user"
test ! -e "$CFO_TEST_CLUSTER" || exit 1
initdb -D "$CFO_TEST_CLUSTER" -U cfo_test -A trust --encoding=UTF8 --locale=C
pg_ctl -D "$CFO_TEST_CLUSTER" -l "$CFO_TEST_CLUSTER/server.log" -o '-h 127.0.0.1 -p 55417' -w -t 15 start
export DATABASE_URL='postgresql://cfo_test@127.0.0.1:55417/postgres'
node tests/integration/probeDisposablePg17.cjs > pg17-readiness.json
```

Запуск от обычного пользователя, не root; PG17 binaries/свободный port должны существовать. Команды подготовлены, в этой Windows-сессии не исполнены. Только status verified и все steps включая dropped_only_owned_database разрешают следующий audit. Record exact PostgreSQL SQL version/image digest/CPU/memory/runtime; tag17 плавающий, digest обязателен для воспроизведения.

```sh
npm ci
npm ci --prefix client
npm install --prefix ../test-runtime --no-save --package-lock=false react@18.3.1 react-test-renderer@18.3.1
export REACT_TEST_RENDERER_PATH="$(cd ../test-runtime/node_modules/react-test-renderer && pwd)"
export V2_SCOPE_TEST_ROOT="$PWD"
node tests/integration/runImportBalanceAudit.cjs ../audit-node20
# Повторить на настоящем Node22 с output ../audit-node22
```

Node20 и22 выбирать через установленный runtime manager; `node --version` должен подтвердить требуемую версию. Не смешивать outputs. Runner принудительно включает real checks, запрещает скрытые skips/нулевые assertions; count/exit metadata есть в каждом job. Load20 выполняется только после всех correctness/build jobs. PostgreSQL major!=17 отказывает. HTTP SQL adapter остаётся отдельным от PostgREST/JWT/RLS.

Остановить только созданный ресурс после сохранения отчётов: `docker stop cfo-acceptance-pg17-20261011` либо `pg_ctl -D "$CFO_TEST_CLUSTER" -m fast -w stop`. Не выполнять общий prune/reset.

## Проверки нового кандидата

Fresh отдельные результаты Node20/22: client unknown-outcome8, strict audit evidence5, V2/scope/parsers/nav57, financial regression44, full-public SQL/Express contract smoke20 (PGlite18.3, NO concurrency proof), build V2 OFF/ON. Их не считать complete runImportBalanceAudit.

Оригинальные совместные31SQL/11HTTP, balance26/import24/restrict14 требуют нового PG17 запуска; counts предыдущего этапа только ориентир. Real writer races теперь15: исходные12 усилены reachable keyed/manual/metadata RPC; добавлены concurrent wallet+opening+late rollback, adjustment stale balance, import/payment/payment-PATCH barriers. Один privileged lock-before-gate40P01 — явный outside-protocol diagnostic, не доказательство публичного endpoint deadlock. Прочитан код и проверен syntax; все15 real scenarios NOT RUN.

Все20 load trials (5 workloads × N1/5/20/50) NOT RUN. Новые manual Business/metadata writers через reachable RPC; long A включает независимый B и shared Personal. N1 сначала queue Business, Personal позже: не измеряет initial Personal wait. Raw latency/gate/scopes/first wait samples, dataset, invariants обязательны. Gate roundtrip включает overhead; strict validator требует20 разных trials, zero unintended errors и balance/provenance checks. Метод отличается от старого raw-manual/B-only набора — старые цифры не новый capacity proof. Общий gate сохранён.

## Следующие решения по порядку

1. Рабочий disposable PG17 probe → full audits обеих Node →15 races/20 trials; локальные исправления при найденной причине, повтор affected/full gates.
2. Authoritative schema/history reconciliation всех target schemas (STAGING_SCHEMA_RECONCILIATION.md); отдельный staging target/plan, без blind history repair.
3. Separate staging rollout/cache/JWT/RLS/browser acceptance. Receipt recovery gap и scope mismatch — ACCEPTANCE_RECEIPTS.md/WALLET_SCOPE_REVIEW.md.
4. Release blockers: capacity global gate, currency/payroll repeat, UI expected_version, opening adjustment до confirm, scope decision, access incident/definer view и actual schema parity. Налоги/HCI/documents/full V2 остаются отдельным backlog; их не расширяли.

При рабочем PG17 без новых failures: инженерная оценка 0.5–1 день audit/evidence; reconciliation и staging JWT/browser приёмка ещё1–3 дня при готовом target и authoritative baseline. Это трудозатраты с предпосылками, не дата завершения; Docker/network repair, продуктовые recovery решения и новые defects в оценку не включены.
