#!/bin/bash
# EC2 user data (Ubuntu 24.04 LTS): Docker Engine + compose plugin, AWS CLI, the infra checkout and the
# non-secret deploy settings. provision.sh replaces __SITE_HOST__ and __GIT_REF__ before launch.
# No secret is passed here: deploy.sh renders them from SSM at run time.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

SITE_HOST="__SITE_HOST__"
GIT_REF="__GIT_REF__"
REPO=https://github.com/cxacraftecosystem-ui/behavioural-games.git

apt-get update -y
apt-get install -y ca-certificates curl git unzip jq
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
# shellcheck disable=SC1091
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  >/etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

# AWS CLI v2 (render-env.sh reads SSM with the instance role).
if ! command -v aws >/dev/null; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
  rm -rf /tmp/aws /tmp/awscliv2.zip
fi

# Unattended security updates (on by default on Ubuntu; make sure).
apt-get install -y unattended-upgrades
systemctl enable --now unattended-upgrades

# Infra checkout (public repository; only infra/ec2 is used on the host).
mkdir -p /opt/shriii
if [ ! -d /opt/shriii/src/.git ]; then
  git init -q /opt/shriii/src
  git -C /opt/shriii/src remote add origin "$REPO"
fi
git -C /opt/shriii/src fetch --quiet --depth 1 origin "$GIT_REF"
git -C /opt/shriii/src checkout --quiet --force FETCH_HEAD

install -d -m 700 /etc/shriii
cat >/etc/shriii/deploy.env <<EOF
SITE_HOST=${SITE_HOST}
IMAGE_TAG=latest
EOF
chmod 600 /etc/shriii/deploy.env

# First deploy if the images are already published; otherwise run deploy.sh over SSM later.
if [ -x /opt/shriii/src/infra/ec2/deploy.sh ]; then
  /opt/shriii/src/infra/ec2/deploy.sh latest "$GIT_REF" || echo "first deploy did not complete; rerun via SSM"
fi
