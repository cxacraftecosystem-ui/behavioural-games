#!/usr/bin/env bash
# Create (or reset) the smoke-test staff account used by the live Playwright check. Run as root via SSM:
#
#   run "/opt/shriii/src/infra/ec2/create-smoke-user.sh [STUDY_ID]"
#
# Account: smoke-test@shriii.local, role researcher, study scope STUDY_ID only (default: the synthetic demo
# study), no initial-password prompt. The password is generated on the operator machine and stored as the
# SecureString /shriii/prod/smoke_test_password; this script reads it with the instance role and passes it to
# `shriii-api create-staff-user` on stdin, so it never appears in argv, logs or the SSM command output.
set -euo pipefail

STUDY_ID="${1:-synthetic-demo-20261022}"
[[ "$STUDY_ID" =~ ^synthetic-[a-z0-9-]+$ ]] || { echo "STUDY_ID must be a synthetic-* study" >&2; exit 2; }
REGION="${AWS_REGION:-ap-south-1}"
SRC=/opt/shriii/src
COMPOSE=(docker compose --env-file /etc/shriii/deploy.env -f "$SRC/infra/ec2/docker-compose.prod.yml")

reset=()
if "${COMPOSE[@]}" --profile ops run --rm --no-deps -T migrate python -c "
import sys
from shriii_api.db.models.ops import StaffUser
from shriii_api.db.session import session_scope
with session_scope() as db:
    sys.exit(0 if db.get(StaffUser, 'smoke-test@shriii.local') else 1)
" 2>/dev/null; then
  reset=(--reset)
fi

aws ssm get-parameter --region "$REGION" --name /shriii/prod/smoke_test_password --with-decryption \
  --query Parameter.Value --output text |
  "${COMPOSE[@]}" --profile ops run --rm --no-deps -T migrate \
    shriii-api create-staff-user smoke-test@shriii.local --roles researcher --studies "$STUDY_ID" \
    --no-change-prompt "${reset[@]}"
echo "smoke-test account ready (scope: $STUDY_ID)"
