#!/usr/bin/env bash
# Synthetic data on production, for deploy verification and research-dashboard demos. Run as root via SSM.
#
#   synthetic.sh smoke              sealed UploadBatch over public HTTPS + worker container processing check
#   synthetic.sh demo [STUDY_ID]    backend demo pipeline (--fast) into a study named "SYNTHETIC DEMO ...",
#                                   then cleanup (revoke the simulator kiosk, undo dev-only approvals)
#
# The demo pipeline drives the API in-process (FastAPI TestClient) with synthetic players, so it runs in a
# one-off container with ENV=dev, AUTH_MODE=dev and a throwaway DEV_JWT_SECRET. The production keys and
# database URLs still come from /etc/shriii/api.env; the public API keeps ENV=prod throughout. The worker
# container is paused for the run so it never claims the demo's dev-mode jobs.
set -euo pipefail

CMD="${1:-}"
SRC=/opt/shriii/src
COMPOSE=(docker compose --env-file /etc/shriii/deploy.env -f "$SRC/infra/ec2/docker-compose.prod.yml")
# shellcheck disable=SC1091
. /etc/shriii/deploy.env

case "$CMD" in
  smoke)
    "${COMPOSE[@]}" --profile ops run --rm --no-deps -T -e SITE_HOST="$SITE_HOST" migrate python - smoke \
      <"$SRC/infra/ec2/synthetic_ops.py"
    ;;
  demo)
    STUDY_ID="${2:-synthetic-demo-$(date -u +%Y%m%d)}"
    [[ "$STUDY_ID" =~ ^synthetic-[a-z0-9-]+$ ]] || { echo "STUDY_ID must start with synthetic-" >&2; exit 2; }
    "${COMPOSE[@]}" stop worker
    trap '"${COMPOSE[@]}" start worker' EXIT
    rc=0
    "${COMPOSE[@]}" --profile ops run --rm --no-deps -T \
      -e ENV=dev -e AUTH_MODE=dev -e DEV_JWT_SECRET="$(openssl rand -hex 32)" -e DB_POOL_SIZE=3 \
      migrate shriii-api demo-pipeline --fast --no-migrate --workers 2 --study-id "$STUDY_ID" \
      --study-name "SYNTHETIC DEMO - simulated players, not research data ($STUDY_ID)" || rc=$?
    "${COMPOSE[@]}" --profile ops run --rm --no-deps -T migrate python - cleanup <"$SRC/infra/ec2/synthetic_ops.py"
    exit $rc
    ;;
  *)
    sed -n '2,12p' "$0"
    exit 2
    ;;
esac
