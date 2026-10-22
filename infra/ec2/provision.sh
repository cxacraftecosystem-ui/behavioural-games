#!/usr/bin/env bash
# Create the SHRIII backend host in ap-south-1 with the AWS CLI (idempotent: existing pieces are reused).
#
#   OPERATOR_CIDR=49.47.131.192/32 infra/ec2/provision.sh [GIT_REF]
#
# Creates, all tagged Project=shriii-kiosk-games:
#   IAM role + instance profile shriii-backend-ec2 (SSM read on /shriii/prod/*, kms:Decrypt via SSM with the
#     default aws/ssm key, AmazonSSMManagedInstanceCore)
#   security group shriii-backend (80/443 from anywhere over IPv4 and IPv6, 22 from OPERATOR_CIDR only)
#   key pair shriii-backend (private key saved to ~/.ssh/shriii-backend.pem; never commit it)
#   Elastic IP shriii-backend, and the hostname <eip-with-dashes>.sslip.io
#   instance shriii-backend: Ubuntu 24.04 LTS (latest, SSM public parameter), t3.medium, 30 GB gp3 encrypted,
#     IMDSv2 required (hop limit 1), termination protection, user data = user-data.sh
# Prints the instance id, Elastic IP and hostname.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: keep /shriii/... and /aws/... literal
export AWS_REGION="${AWS_REGION:-ap-south-1}"
export AWS_PAGER=""

GIT_REF="${1:-main}"
NAME=shriii-backend
PROJECT=shriii-kiosk-games
OPERATOR_CIDR="${OPERATOR_CIDR:?set OPERATOR_CIDR, e.g. 49.47.131.192/32}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.medium}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
TAGS_IAM=("Key=Project,Value=$PROJECT" "Key=Name,Value=$NAME")
tagspec() { echo "ResourceType=$1,Tags=[{Key=Project,Value=$PROJECT},{Key=Name,Value=$NAME}]"; }
log() { printf '[provision] %s\n' "$*"; }

# ------------------------------------------------------------------ IAM role and instance profile
if ! aws iam get-role --role-name "$NAME-ec2" >/dev/null 2>&1; then
  log "create role $NAME-ec2"
  aws iam create-role --role-name "$NAME-ec2" --tags "${TAGS_IAM[@]}" \
    --description "SHRIII backend EC2: read /shriii/prod/* from SSM, SSM Session Manager" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
fi
KMS_KEY_ARN="$(aws kms describe-key --key-id alias/aws/ssm --query KeyMetadata.Arn --output text)"
POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadProdParameters",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
      "Resource": [
        "arn:aws:ssm:${AWS_REGION}:${ACCOUNT}:parameter/shriii/prod",
        "arn:aws:ssm:${AWS_REGION}:${ACCOUNT}:parameter/shriii/prod/*"
      ]
    },
    {
      "Sid": "DecryptViaSsm",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "${KMS_KEY_ARN}",
      "Condition": {"StringEquals": {"kms:ViaService": "ssm.${AWS_REGION}.amazonaws.com"}}
    }
  ]
}
EOF
)
aws iam put-role-policy --role-name "$NAME-ec2" --policy-name shriii-prod-ssm-read --policy-document "$POLICY"
aws iam attach-role-policy --role-name "$NAME-ec2" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
if ! aws iam get-instance-profile --instance-profile-name "$NAME-ec2" >/dev/null 2>&1; then
  log "create instance profile $NAME-ec2"
  aws iam create-instance-profile --instance-profile-name "$NAME-ec2" --tags "${TAGS_IAM[@]}" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$NAME-ec2" --role-name "$NAME-ec2"
  sleep 10 # IAM propagation before run-instances
fi

# ------------------------------------------------------------------ security group (default VPC)
VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
SG_ID="$(aws ec2 describe-security-groups --filters Name=group-name,Values=$NAME Name=vpc-id,Values="$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text)"
if [[ "$SG_ID" == "None" ]]; then
  log "create security group $NAME"
  SG_ID="$(aws ec2 create-security-group --group-name $NAME --vpc-id "$VPC_ID" \
    --description "SHRIII backend: HTTPS public, SSH from operator only" \
    --tag-specifications "$(tagspec security-group)" --query GroupId --output text)"
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --tag-specifications "$(tagspec security-group-rule)" \
    --ip-permissions \
    "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP-ACME-redirect}],Ipv6Ranges=[{CidrIpv6=::/0,Description=HTTP-ACME-redirect}]" \
    "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTPS}],Ipv6Ranges=[{CidrIpv6=::/0,Description=HTTPS}]" \
    "IpProtocol=udp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP3}],Ipv6Ranges=[{CidrIpv6=::/0,Description=HTTP3}]" \
    "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$OPERATOR_CIDR,Description=operator-ssh}]" >/dev/null
fi

# ------------------------------------------------------------------ key pair
KEY_FILE="$HOME/.ssh/$NAME.pem"
if ! aws ec2 describe-key-pairs --key-names $NAME >/dev/null 2>&1; then
  log "create key pair $NAME -> $KEY_FILE"
  mkdir -p "$HOME/.ssh"
  (umask 077 && aws ec2 create-key-pair --key-name $NAME --key-type ed25519 --key-format pem \
    --tag-specifications "$(tagspec key-pair)" --query KeyMaterial --output text >"$KEY_FILE")
  chmod 600 "$KEY_FILE"
fi

# ------------------------------------------------------------------ Elastic IP and hostname
ALLOC_ID="$(aws ec2 describe-addresses --filters Name=tag:Name,Values=$NAME Name=tag:Project,Values=$PROJECT \
  --query 'Addresses[0].AllocationId' --output text)"
if [[ "$ALLOC_ID" == "None" ]]; then
  log "allocate Elastic IP"
  ALLOC_ID="$(aws ec2 allocate-address --domain vpc --tag-specifications "$(tagspec elastic-ip)" \
    --query AllocationId --output text)"
fi
EIP="$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].PublicIp' --output text)"
SITE_HOST="${EIP//./-}.sslip.io"

# ------------------------------------------------------------------ instance
INSTANCE_ID="$(aws ec2 describe-instances --filters Name=tag:Name,Values=$NAME Name=tag:Project,Values=$PROJECT \
  Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)"
if [[ "$INSTANCE_ID" == "None" ]]; then
  AMI_ID="$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query Parameter.Value --output text)"
  ROOT_DEV="$(aws ec2 describe-images --image-ids "$AMI_ID" --query 'Images[0].RootDeviceName' --output text)"
  USER_DATA="$(mktemp)"
  sed -e "s#__SITE_HOST__#$SITE_HOST#" -e "s#__GIT_REF__#$GIT_REF#" "$HERE/user-data.sh" >"$USER_DATA"
  UD_PATH="$USER_DATA"
  if command -v cygpath >/dev/null; then UD_PATH="$(cygpath -m "$USER_DATA")"; fi # aws.exe on Windows
  log "launch $INSTANCE_TYPE from $AMI_ID"
  INSTANCE_ID="$(aws ec2 run-instances --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" --key-name $NAME \
    --security-group-ids "$SG_ID" --iam-instance-profile Name="$NAME-ec2" \
    --block-device-mappings "DeviceName=$ROOT_DEV,Ebs={VolumeSize=30,VolumeType=gp3,Encrypted=true,DeleteOnTermination=true}" \
    --metadata-options HttpTokens=required,HttpPutResponseHopLimit=1,HttpEndpoint=enabled,InstanceMetadataTags=disabled \
    --disable-api-termination \
    --user-data "file://$UD_PATH" \
    --tag-specifications "$(tagspec instance)" "$(tagspec volume)" "$(tagspec network-interface)" \
    --query 'Instances[0].InstanceId' --output text)"
  rm -f "$USER_DATA"
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
fi
aws ec2 associate-address --allocation-id "$ALLOC_ID" --instance-id "$INSTANCE_ID" --allow-reassociation >/dev/null

echo "INSTANCE_ID=$INSTANCE_ID"
echo "ELASTIC_IP=$EIP"
echo "SITE_HOST=$SITE_HOST"
echo "API_BASE_URL=https://$SITE_HOST"
