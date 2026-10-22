#!/usr/bin/env bash
# Render the backend's secret environment from SSM Parameter Store into a root-only file.
#
#   sudo infra/ec2/render-env.sh [/etc/shriii/api.env]
#
# Every parameter under SSM_PREFIX (default /shriii/prod/) whose last path segment is an upper-case
# environment variable name (DATABASE_URL, LOCAL_JWT_SECRET, ...) becomes VAR='value'. Lower-case names
# (db_password, admin_initial_password, ...) are operator material and are skipped. The file is written
# atomically with mode 0600 and never printed. Runs with the instance role (ssm:GetParametersByPath and
# kms:Decrypt on that prefix only).
set -euo pipefail
umask 077

OUT="${1:-/etc/shriii/api.env}"
PREFIX="${SSM_PREFIX:-/shriii/prod/}"
REGION="${AWS_REGION:-ap-south-1}"
REQUIRED=(DATABASE_URL IDENTITY_DATABASE_URL LOCAL_JWT_SECRET PID_HMAC_PEPPER SESSION_KEY_KEK
  BACKEND_X25519_PRIVATE_KEY RELEASE_PACK_SIGNING_KEY IDENTITY_VAULT_KEY)

mkdir -p "$(dirname "$OUT")"
chmod 700 "$(dirname "$OUT")"
tmp="$(mktemp "$(dirname "$OUT")/.api.env.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

aws ssm get-parameters-by-path --region "$REGION" --path "$PREFIX" --recursive --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text |
  while IFS=$'\t' read -r name value; do
    var="${name##*/}"
    [[ "$var" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
    if [[ "$value" == *"'"* || "$value" == *$'\n'* ]]; then
      echo "render-env: $name contains a quote or newline; refusing" >&2
      exit 1
    fi
    printf "%s='%s'\n" "$var" "$value"
  done >"$tmp"

missing=()
for var in "${REQUIRED[@]}"; do
  grep -q "^${var}=" "$tmp" || missing+=("$var")
done
if ((${#missing[@]})); then
  echo "render-env: missing SSM parameters under $PREFIX: ${missing[*]}" >&2
  exit 1
fi

chown root:root "$tmp"
chmod 600 "$tmp"
mv -f "$tmp" "$OUT"
trap - EXIT
echo "render-env: wrote $(wc -l <"$OUT") variables to $OUT (values not shown)"
