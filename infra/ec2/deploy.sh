#!/usr/bin/env bash
# Deploy (or roll back) the SHRIII backend on this instance. Run as root, normally through SSM:
#
#   aws ssm send-command --document-name AWS-RunShellScript --targets Key=tag:Name,Values=shriii-backend \
#     --parameters 'commands=["/opt/shriii/src/infra/ec2/deploy.sh latest main"]'
#
#   deploy.sh [IMAGE_TAG] [GIT_REF]
#     IMAGE_TAG  image tag to run: "latest" (default) or a full commit sha (rollback = an older sha)
#     GIT_REF    revision of this repository whose infra/ec2 files to use (default: main)
#
# Steps: update the infra checkout -> render secrets from SSM -> pull images -> Alembic upgrade (research +
# identity) -> start/replace containers -> health check over HTTPS through Caddy with certificate checks.
set -euo pipefail

IMAGE_TAG="${1:-latest}"
GIT_REF="${2:-main}"
SRC=/opt/shriii/src
ETC=/etc/shriii
COMPOSE=(docker compose --env-file "$ETC/deploy.env" -f "$SRC/infra/ec2/docker-compose.prod.yml")

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

[[ "$IMAGE_TAG" =~ ^(latest|[0-9a-f]{40})$ ]] || { echo "IMAGE_TAG must be 'latest' or a 40-char sha" >&2; exit 2; }
[[ "$GIT_REF" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "invalid GIT_REF" >&2; exit 2; }

log "infra checkout -> $GIT_REF"
git -C "$SRC" fetch --quiet --depth 1 origin "$GIT_REF"
git -C "$SRC" checkout --quiet --force FETCH_HEAD
log "infra at $(git -C "$SRC" rev-parse --short HEAD)"
# Continue with the freshly checked-out copy of this script, not the one bash already started reading.
if [[ -z "${SHRIII_DEPLOY_REEXEC:-}" ]]; then
  SHRIII_DEPLOY_REEXEC=1 exec "$SRC/infra/ec2/deploy.sh" "$IMAGE_TAG" "$GIT_REF"
fi

# Non-secret deploy settings: keep SITE_HOST (written by user data), update IMAGE_TAG.
touch "$ETC/deploy.env"
grep -q '^SITE_HOST=' "$ETC/deploy.env" || { echo "SITE_HOST missing from $ETC/deploy.env" >&2; exit 1; }
sed -i '/^IMAGE_TAG=/d' "$ETC/deploy.env"
echo "IMAGE_TAG=$IMAGE_TAG" >>"$ETC/deploy.env"
# shellcheck disable=SC1091
. "$ETC/deploy.env"

log "render secrets from SSM"
"$SRC/infra/ec2/render-env.sh" "$ETC/api.env"

REGISTRY="${IMAGE_REGISTRY:-626159998512.dkr.ecr.ap-south-1.amazonaws.com/shriii}"
if [[ "$REGISTRY" == *.dkr.ecr.*.amazonaws.com/* ]]; then
  log "ECR login (instance role)"
  aws ecr get-login-password --region "${AWS_REGION:-ap-south-1}" |
    docker login --username AWS --password-stdin "${REGISTRY%%/*}" >/dev/null
fi

log "pull images ($REGISTRY, $IMAGE_TAG)"
"${COMPOSE[@]}" --profile ops pull --quiet api worker migrate caddy

log "migrate (research + identity)"
"${COMPOSE[@]}" --profile ops run --rm --no-deps migrate

log "start containers"
"${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 180 api worker caddy

log "health check https://$SITE_HOST"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 10 --resolve "$SITE_HOST:443:127.0.0.1" "https://$SITE_HOST/healthz" >/dev/null &&
    curl -fsS --max-time 10 --resolve "$SITE_HOST:443:127.0.0.1" "https://$SITE_HOST/readyz" >/dev/null; then
    ok=1
    break
  fi
  sleep 10
done
if [[ $ok -ne 1 ]]; then
  log "health check FAILED"
  "${COMPOSE[@]}" ps
  "${COMPOSE[@]}" logs --no-color --tail 80 api caddy
  exit 1
fi
curl -fsS --resolve "$SITE_HOST:443:127.0.0.1" "https://$SITE_HOST/readyz"
echo
"${COMPOSE[@]}" images --format table 2>/dev/null || "${COMPOSE[@]}" images
docker image prune -f --filter "until=168h" >/dev/null || true
log "deployed $IMAGE_TAG"
