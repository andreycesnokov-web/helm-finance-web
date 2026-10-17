#!/usr/bin/env bash
# Disposable local Supabase-equivalent stack for the CFO AI V2 clean-install rehearsal (Supabase's own images).
# Every port is published on 127.0.0.1 only; containers share the private network xr-ci-net.
#   db 55440 · mailpit UI/API 55441 · gotrue 55443 · postgrest 55444 · storage 55445 (gateway 55450 is gateway.cjs)
# Usage: stack.sh up | down | auth (recreate GoTrue) | storage (recreate Storage)
# Env: GOTRUE_EXTRA="-e KEY=VALUE ..." adds GoTrue settings (e.g. rate limits, Sb-Forwarded-For) for a run.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash would rewrite "/auth/v1/verify" into a Windows path inside -e values
HERE="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))"   # Windows path for node under Git Bash
j() { node "$HERE/env.cjs" "$1"; }
PW=$(j db_password); JWT=$(j supabase_jwt_secret); ANON=$(j anon_key); SERVICE=$(j service_key)
APP=${APP_BASE_URL:-http://127.0.0.1:55470}
GW=http://127.0.0.1:55450
auth_up() {
  # shellcheck disable=SC2086
  docker run -d --name xr-ci-auth --network xr-ci-net -p 127.0.0.1:55443:9999 \
    -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL="$GW" \
    -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$PW@xr-ci-db:5432/postgres" \
    -e GOTRUE_SITE_URL="$APP" -e GOTRUE_URI_ALLOW_LIST="$APP/auth/**" -e GOTRUE_DISABLE_SIGNUP=false \
    -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
    -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_SECRET="$JWT" -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
    -e GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false -e GOTRUE_EXTERNAL_PHONE_ENABLED=false -e GOTRUE_MAILER_AUTOCONFIRM=false \
    -e GOTRUE_PASSWORD_MIN_LENGTH=10 -e GOTRUE_MAILER_OTP_EXP=3600 -e GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true \
    -e GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 -e GOTRUE_SMTP_MAX_FREQUENCY=1s \
    -e GOTRUE_SMTP_HOST=xr-ci-mail -e GOTRUE_SMTP_PORT=1025 -e GOTRUE_SMTP_ADMIN_EMAIL=no-reply@rehearsal.invalid \
    -e GOTRUE_SMTP_SENDER_NAME="CFO AI (rehearsal)" -e GOTRUE_SMTP_USER=rehearsal -e GOTRUE_SMTP_PASS=rehearsal \
    -e GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify -e GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify \
    -e GOTRUE_MAILER_URLPATHS_INVITE=/auth/v1/verify -e GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify \
    ${GOTRUE_EXTRA:-} public.ecr.aws/supabase/gotrue:v2.195.0 >/dev/null
  for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:55443/health && break; sleep 1; done
}
storage_up() {
  docker run -d --name xr-ci-storage --network xr-ci-net -p 127.0.0.1:55445:5000 \
    -e ANON_KEY="$ANON" -e SERVICE_KEY="$SERVICE" -e POSTGREST_URL=http://xr-ci-rest:3000 -e PGRST_JWT_SECRET="$JWT" -e AUTH_JWT_SECRET="$JWT" \
    -e DATABASE_URL="postgres://supabase_storage_admin:$PW@xr-ci-db:5432/postgres" -e FILE_SIZE_LIMIT=52428800 \
    -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e TENANT_ID=stub -e REGION=stub \
    -e GLOBAL_S3_BUCKET=stub -e ENABLE_IMAGE_TRANSFORMATION=false public.ecr.aws/supabase/storage-api:v1.68.10 >/dev/null
  for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:55445/status && break; sleep 1; done
}
case "${1:-up}" in
up)
  docker network create xr-ci-net >/dev/null
  docker run -d --name xr-ci-db --network xr-ci-net -p 127.0.0.1:55440:5432 \
    -e POSTGRES_PASSWORD="$PW" -e JWT_SECRET="$JWT" -e JWT_EXP=3600 public.ecr.aws/supabase/postgres:17.6.1.158 >/dev/null
  for i in $(seq 1 90); do docker exec xr-ci-db pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
  sleep 3
  docker exec -i xr-ci-db psql -v ON_ERROR_STOP=1 -U supabase_admin -h 127.0.0.1 -d postgres -q <<SQL
ALTER USER authenticator WITH PASSWORD '$PW';
ALTER USER supabase_auth_admin WITH PASSWORD '$PW';
ALTER USER supabase_storage_admin WITH PASSWORD '$PW';
SQL
  docker run -d --name xr-ci-mail --network xr-ci-net -p 127.0.0.1:55441:8025 public.ecr.aws/supabase/mailpit:v1.30.2 >/dev/null
  docker run -d --name xr-ci-rest --network xr-ci-net -p 127.0.0.1:55444:3000 \
    -e PGRST_DB_URI="postgres://authenticator:$PW@xr-ci-db:5432/postgres" -e PGRST_DB_SCHEMAS=public,storage,graphql_public \
    -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT" -e PGRST_DB_USE_LEGACY_GUCS=false \
    -e PGRST_APP_SETTINGS_JWT_SECRET="$JWT" -e PGRST_APP_SETTINGS_JWT_EXP=3600 public.ecr.aws/supabase/postgrest:v14.16 >/dev/null
  auth_up
  storage_up
  echo "stack up"
  ;;
auth) docker rm -f xr-ci-auth >/dev/null 2>&1 || true; auth_up; echo "auth recreated" ;;
storage) docker rm -f -v xr-ci-storage >/dev/null 2>&1 || true; storage_up; echo "storage recreated" ;;
down)
  docker rm -f -v xr-ci-storage xr-ci-rest xr-ci-auth xr-ci-mail xr-ci-db xr-ci-db2 xr-ci-auth2 xr-ci-storage2 >/dev/null 2>&1 || true
  docker network rm xr-ci-net >/dev/null 2>&1 || true
  echo "stack down"
  ;;
esac
