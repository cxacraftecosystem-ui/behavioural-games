#!/usr/bin/env bash
# One-time: create the first staff admin account (AUTH_MODE=local). Run as root on the instance via SSM:
#
#   aws ssm send-command --document-name AWS-RunShellScript --targets Key=tag:Name,Values=shriii-backend \
#     --parameters 'commands=["/opt/shriii/src/infra/ec2/create-admin.sh admin"]'
#
# The password is generated on the operator machine by init-secrets.sh and stored as the SecureString
# /shriii/prod/admin_initial_password; this script reads it with the instance role and passes it to
# `shriii-api create-staff-user` on stdin, so it never appears in argv, logs or the SSM command output.
# Pass --reset as the second argument to reset an existing account to that password.
set -euo pipefail

USERNAME="${1:-admin}"
RESET="${2:-}"
REGION="${AWS_REGION:-ap-south-1}"
SRC=/opt/shriii/src
COMPOSE=(docker compose --env-file /etc/shriii/deploy.env -f "$SRC/infra/ec2/docker-compose.prod.yml")
extra=()
[[ "$RESET" == "--reset" ]] && extra+=(--reset)

aws ssm get-parameter --region "$REGION" --name /shriii/prod/admin_initial_password --with-decryption \
  --query Parameter.Value --output text |
  "${COMPOSE[@]}" --profile ops run --rm --no-deps -T migrate \
    shriii-api create-staff-user "$USERNAME" --roles admin "${extra[@]}"
echo "staff user '$USERNAME' ready; sign in and change the password (POST /api/v1/auth/password)"
