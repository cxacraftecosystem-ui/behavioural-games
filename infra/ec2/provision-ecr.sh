#!/usr/bin/env bash
# ECR mirror of the backend images, pushed by GitHub Actions through OIDC (no long-lived AWS keys) and pulled by
# the instance role. Needed because GHCR packages under a personal account start private and their visibility
# can only be changed in the GitHub UI; the instance pulls from ECR either way. Idempotent.
#
#   infra/ec2/provision-ecr.sh
#
# Creates, tagged Project=shriii-kiosk-games:
#   ECR repositories shriii/behavioural-games-api and -worker (scan on push, AES256, keep the newest 30 images)
#   IAM OIDC provider token.actions.githubusercontent.com (if missing)
#   IAM role shriii-gha-ecr-push: assumable only by workflows on refs/heads/main of
#     cxacraftecosystem-ui/behavioural-games; may push to those two repositories only
#   inline policy shriii-ecr-pull on the instance role shriii-backend-ec2 (pull from those repositories)
set -euo pipefail
export MSYS_NO_PATHCONV=1
export AWS_REGION="${AWS_REGION:-ap-south-1}"
export AWS_PAGER=""

PROJECT=shriii-kiosk-games
REPO_SLUG=cxacraftecosystem-ui/behavioural-games
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
TAGS=("Key=Project,Value=$PROJECT")
log() { printf '[provision-ecr] %s\n' "$*"; }

for name in api worker; do
  repo="shriii/behavioural-games-$name"
  if ! aws ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1; then
    log "create ECR repository $repo"
    aws ecr create-repository --repository-name "$repo" --image-scanning-configuration scanOnPush=true \
      --encryption-configuration encryptionType=AES256 --image-tag-mutability MUTABLE \
      --tags Key=Project,Value=$PROJECT >/dev/null
  fi
  aws ecr put-lifecycle-policy --repository-name "$repo" --lifecycle-policy-text \
    '{"rules":[{"rulePriority":1,"description":"keep newest 30","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":30},"action":{"type":"expire"}}]}' >/dev/null
done
REPO_ARNS="\"arn:aws:ecr:${AWS_REGION}:${ACCOUNT}:repository/shriii/behavioural-games-api\", \"arn:aws:ecr:${AWS_REGION}:${ACCOUNT}:repository/shriii/behavioural-games-worker\""

OIDC_ARN="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  log "create GitHub OIDC provider"
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com --tags "${TAGS[@]}" >/dev/null
fi

TRUST=$(cat <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Federated":"${OIDC_ARN}"},
"Action":"sts:AssumeRoleWithWebIdentity","Condition":{"StringEquals":{
"token.actions.githubusercontent.com:aud":"sts.amazonaws.com",
"token.actions.githubusercontent.com:sub":"repo:${REPO_SLUG}:ref:refs/heads/main"}}}]}
EOF
)
if ! aws iam get-role --role-name shriii-gha-ecr-push >/dev/null 2>&1; then
  log "create role shriii-gha-ecr-push"
  aws iam create-role --role-name shriii-gha-ecr-push --tags "${TAGS[@]}" --max-session-duration 3600 \
    --description "GitHub Actions (main of ${REPO_SLUG}) pushes backend images to ECR" \
    --assume-role-policy-document "$TRUST" >/dev/null
else
  aws iam update-assume-role-policy --role-name shriii-gha-ecr-push --policy-document "$TRUST"
fi
aws iam put-role-policy --role-name shriii-gha-ecr-push --policy-name shriii-ecr-push --policy-document "$(cat <<EOF
{"Version":"2012-10-17","Statement":[
{"Effect":"Allow","Action":"ecr:GetAuthorizationToken","Resource":"*"},
{"Effect":"Allow","Action":["ecr:BatchCheckLayerAvailability","ecr:BatchGetImage","ecr:GetDownloadUrlForLayer",
"ecr:InitiateLayerUpload","ecr:UploadLayerPart","ecr:CompleteLayerUpload","ecr:PutImage"],"Resource":[${REPO_ARNS}]}]}
EOF
)"
aws iam put-role-policy --role-name shriii-backend-ec2 --policy-name shriii-ecr-pull --policy-document "$(cat <<EOF
{"Version":"2012-10-17","Statement":[
{"Effect":"Allow","Action":"ecr:GetAuthorizationToken","Resource":"*"},
{"Effect":"Allow","Action":["ecr:BatchCheckLayerAvailability","ecr:BatchGetImage","ecr:GetDownloadUrlForLayer"],
"Resource":[${REPO_ARNS}]}]}
EOF
)"
echo "ECR_REGISTRY=${ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"
echo "PUSH_ROLE_ARN=arn:aws:iam::${ACCOUNT}:role/shriii-gha-ecr-push"
