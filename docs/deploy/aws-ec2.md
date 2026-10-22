# Backend on AWS EC2 (production pilot)

The API and the job worker run as containers on one EC2 instance in `ap-south-1` (Mumbai), behind Caddy,
which terminates TLS with an automatic Let's Encrypt certificate. The databases are on Supabase in the same
region ([supabase.md](supabase.md)). Images are built by GitHub Actions and pulled from GHCR. Every secret
lives in AWS SSM Parameter Store; none is in this repository, in an image, or in user data.

```
Vercel web app ──HTTPS──▶ Caddy :443 (52-66-109-32.sslip.io, HSTS, size limits, security headers)
kiosks (device tokens) ─▶   └─▶ api:8000  (FastAPI, ENV=prod, AUTH_MODE=local)
                              worker      (Postgres job queue)        ──TLS──▶ Supabase session pooler :5432
                                                                               (research DB + identity vault)
EC2 instance role ──▶ SSM /shriii/prod/* (SecureString, aws/ssm KMS key) ──▶ /etc/shriii/api.env (root, 0600)
```

## What runs where

| Item | Value |
|---|---|
| API base URL | `https://52-66-109-32.sslip.io` (`/healthz`, `/readyz`, `/api/v1/...`, `/docs`) |
| Instance | `i-0fb9646b9ad18744b`, `shriii-backend`, t3.medium, Ubuntu 24.04 LTS, 30 GB gp3 (encrypted), IMDSv2 only |
| Elastic IP | `52.66.109.32` (hostname `52-66-109-32.sslip.io` via sslip.io wildcard DNS) |
| Security group | `shriii-backend`: 80/443 TCP and 443 UDP from `0.0.0.0/0` and `::/0`; 22 from the operator IP only |
| IAM | role and instance profile `shriii-backend-ec2`: `ssm:GetParameter(s)`/`GetParametersByPath` on `/shriii/prod/*`, `kms:Decrypt` on the `aws/ssm` key via SSM only, `AmazonSSMManagedInstanceCore` |
| Key pair | `shriii-backend` (ed25519); private key only on the operator machine at `~/.ssh/shriii-backend.pem` |
| Images | `ghcr.io/cxacraftecosystem-ui/behavioural-games-api` and `-worker`, tags `<commit sha>` and `latest` |
| Files on the host | `/opt/shriii/src` (shallow checkout; only `infra/ec2` is used), `/etc/shriii/deploy.env` (`SITE_HOST`, `IMAGE_TAG`), `/etc/shriii/api.env` (secrets, root 0600) |
| Tags | every AWS resource carries `Project=shriii-kiosk-games` |

Containers (`infra/ec2/docker-compose.prod.yml`): `api`, `worker` and `caddy`, plus the one-shot `migrate`
service (profile `ops`) used for migrations and operator commands. The backend containers run as an
unprivileged user with a read-only root filesystem, no Linux capabilities and `no-new-privileges`. Only
Caddy publishes ports.

### Edge (Caddy)

- Automatic HTTPS for `SITE_HOST`; HTTP redirects to HTTPS.
- Headers: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`,
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` (a narrower policy that allows the
  Swagger/ReDoc CDN on `/docs` and `/redoc`); `Server` is removed.
- Body limits: 2 MB for `POST /api/v1/events/batch` (the API itself caps an UploadBatch at `MAX_BATCH_BYTES`,
  1 MiB), 10 MB for criterion CSV/XLSX imports, 2 MB for everything else. Header read timeout 10 s, body 60 s.

### API settings

Non-secret production settings are in `infra/ec2/api.prod.env`: `ENV=prod`, `AUTH_MODE=local`, CORS, issuer.
With `ENV=prod` the API refuses dev login, refuses plaintext (`none_dev`) chunks, and will not start unless
every key is supplied.

**CORS.** The Vercel project `behavioural-games` (scope `cxacraftecosystem-8028`) did not exist yet, so the
API allows `https://behavioural-games.vercel.app` plus the pattern
`API_CORS_ORIGIN_REGEX=https://behavioural-games[a-z0-9-]*\.vercel\.app`, which also matches the team's preview
URLs (`behavioural-games-<hash>-cxacraftecosystem-8028s-projects.vercel.app`). The pattern would also match an
unrelated Vercel project whose name starts with `behavioural-games`. Auth uses bearer tokens, not cookies, so
this does not expose sessions, but once the production domain is known, set `API_CORS_ORIGINS` to the exact
origin(s) (and the custom domain), narrow or drop the regex, and redeploy.

**Staff accounts (`AUTH_MODE=local`).** There is no Cognito/OIDC provider yet, so staff accounts are stored in
`governance.staff_users` (migration 0006) with scrypt password hashes. `POST /api/v1/auth/login`
(`{"username","password"}`) returns a bearer JWT (HS256, `LOCAL_JWT_SECRET`, 8 h). Five failed attempts lock an
account for 15 minutes. `POST /api/v1/auth/password` changes the caller's password. Accounts are created or
reset only from the CLI (`shriii-api create-staff-user <username> --roles ... [--reset]`, password on stdin),
never over HTTP. To move to OIDC later, set `AUTH_MODE=oidc`, `OIDC_JWKS_URL`, `JWT_ISSUER` and `JWT_AUDIENCE`;
the staff table then goes unused.

The web app's login page currently offers dev and OIDC modes only. Until it gains a password form against
`/api/v1/auth/login`, staff use the API directly (for example from `/docs`).

## SSM parameters (`/shriii/prod/`, SecureString)

| Name | Made by | Used as |
|---|---|---|
| `DATABASE_URL`, `IDENTITY_DATABASE_URL` | `infra/supabase/bootstrap_roles.py` | env vars of the same name |
| `db_password`, `db_app_password`, `identity_db_password` | `bootstrap_roles.py` | operator material (not loaded into containers) |
| `LOCAL_JWT_SECRET` (48 bytes), `PID_HMAC_PEPPER`, `SESSION_KEY_KEK`, `BACKEND_X25519_PRIVATE_KEY`, `RELEASE_PACK_SIGNING_KEY`, `IDENTITY_VAULT_KEY` (32 bytes each, base64) | `infra/ec2/init-secrets.sh` | env vars of the same name |
| `admin_initial_password` | `init-secrets.sh` | first admin password, read by `create-admin.sh` |

`render-env.sh` copies every upper-case name under the prefix into `/etc/shriii/api.env` at each deploy and
skips lower-case names. The instance role can read the prefix but cannot write anything.

## Operations

All host commands run through SSM Run Command (no SSH needed). From the operator machine:

```bash
export AWS_REGION=ap-south-1 MSYS_NO_PATHCONV=1   # the second one only in Git Bash on Windows
run() {   # run one shell command on the instance as root and print its output
  id=$(aws ssm send-command --instance-ids i-0fb9646b9ad18744b --document-name AWS-RunShellScript \
        --parameters "commands=[\"$1\"]" --query Command.CommandId --output text)
  aws ssm wait command-executed --command-id "$id" --instance-id i-0fb9646b9ad18744b || true
  aws ssm get-command-invocation --command-id "$id" --instance-id i-0fb9646b9ad18744b \
        --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
}
```

| Task | Command |
|---|---|
| Deploy the newest images | `run "/opt/shriii/src/infra/ec2/deploy.sh latest main"` |
| Roll back | `run "/opt/shriii/src/infra/ec2/deploy.sh <older full commit sha> main"` (each image tag is a commit sha; see the Images workflow summary or `gh api /users/cxacraftecosystem-ui/packages/container/behavioural-games-api/versions`) |
| Status / logs | `run "cd /opt/shriii/src/infra/ec2 && docker compose --env-file /etc/shriii/deploy.env -f docker-compose.prod.yml ps"`, then `... logs --tail 100 api` |
| Create the first admin | `run "/opt/shriii/src/infra/ec2/create-admin.sh admin"`; read the password with `aws ssm get-parameter --name /shriii/prod/admin_initial_password --with-decryption`, sign in, change it, then delete that parameter |
| Reset a staff password | put a new value in `/shriii/prod/admin_initial_password`, then `run "/opt/shriii/src/infra/ec2/create-admin.sh <username> --reset"` |
| Smoke test | `run "/opt/shriii/src/infra/ec2/synthetic.sh smoke"` |
| Synthetic demo data | `run "/opt/shriii/src/infra/ec2/synthetic.sh demo synthetic-demo-<yyyymmdd>"` |
| Shell | `aws ssm start-session --target i-0fb9646b9ad18744b`, or `ssh -i ~/.ssh/shriii-backend.pem ubuntu@52.66.109.32` from the operator IP |

`deploy.sh [IMAGE_TAG] [GIT_REF]` updates the infra checkout, renders secrets from SSM, pulls the images, runs
`shriii-api migrate` (research and identity databases) in a one-shot container, replaces the containers, and
checks `/healthz` and `/readyz` over HTTPS through Caddy with full certificate verification. A failed check
prints the logs and exits non-zero. Migrations are forward-only in practice: a rollback to an image older than
the newest migration still runs against the newer schema, so keep migrations backwards compatible for one
release.

Pushes to `main` that touch the backend build and push both images (`.github/workflows/images.yml`); the
deploy is a separate, deliberate step (the command above).

### Synthetic data on production

`synthetic.sh smoke` seals one UploadBatch per simulated session to the backend X25519 key (AES-256-GCM, as a
real kiosk does), posts it to the public HTTPS endpoint with a device token, and waits for the worker container
to finish the jobs the upload queued. The data goes into the study `synthetic-smoke` (named "SYNTHETIC SMOKE
TEST").

`synthetic.sh demo` runs `shriii-api demo-pipeline --fast` into a study whose id starts with `synthetic-` and
whose name starts with "SYNTHETIC DEMO", so the research dashboards have data. The pipeline drives the API
in-process, so it runs in a one-off container with `ENV=dev`/`AUTH_MODE=dev` and a throwaway dev secret; the
public API stays `ENV=prod`. The worker is paused during the run. Afterwards the cleanup step revokes the
simulator kiosk (`kiosk-sim-01`) and undoes the dev-only instrument approvals the pipeline records (synthetic
"granted" permissions and dev-approved language versions), so no instrument looks licensed for real use. The
synthetic chunks are stored as `none_dev` plaintext: they are simulated players, not participants. Remove a
synthetic study through the normal erasure/retention paths, or leave it as a labelled demo.

## Rotating secrets

| Secret | How |
|---|---|
| `LOCAL_JWT_SECRET` | put a new 48-byte base64 value, then deploy. Every staff token becomes invalid; staff sign in again. |
| Database passwords | re-run `infra/supabase/bootstrap_roles.py` (it rewrites the passwords and both URLs in SSM), then deploy. |
| `RELEASE_PACK_SIGNING_KEY` | put a new key, bump `RELEASE_PACK_KEY_ID` in `api.prod.env`, deploy. Old packs stay verifiable only with the old public key, so archive it first. |
| `BACKEND_X25519_PRIVATE_KEY` | kiosks seal to the public key returned at registration. Re-register (or re-key) every kiosk in the same change, and drain every outbox first: batches sealed to the old key can no longer be opened. |
| `SESSION_KEY_KEK`, `IDENTITY_VAULT_KEY`, `PID_HMAC_PEPPER` | **do not rotate in place.** Stored session keys and vault contact data are encrypted under them, and pid derivation depends on the pepper (`PID_PEPPER_VERSION`). Rotation needs a re-wrap migration; plan it separately. |

Write a new value with `aws ssm put-parameter --name /shriii/prod/<NAME> --type SecureString --overwrite
--value "$(python -c 'import base64,secrets;print(base64.b64encode(secrets.token_bytes(32)).decode())')"`, then
deploy, which re-renders `/etc/shriii/api.env`.

## Rebuilding from scratch

```bash
infra/ec2/init-secrets.sh                                   # creates missing app secrets only
OPERATOR_CIDR=<your ip>/32 infra/ec2/provision.sh main      # IAM, SG, key pair, EIP, instance (idempotent)
# user data installs Docker, compose, the AWS CLI and the checkout, and deploys if images exist; otherwise:
run "/opt/shriii/src/infra/ec2/deploy.sh latest main"
run "/opt/shriii/src/infra/ec2/create-admin.sh admin"
```

The GHCR packages must be public so the instance can pull without credentials (package settings, Change
visibility). If they are made private, store a `read:packages` token in SSM and add a `docker login ghcr.io`
step to `deploy.sh`.

## Costs (ap-south-1, on-demand, approximate)

| Item | Monthly |
|---|---|
| t3.medium (2 vCPU, 4 GiB) | about $33 |
| 30 GB gp3 | about $2.7 |
| Elastic IP / public IPv4 | about $3.6 |
| Data out | first 100 GB/month free, then about $0.11/GB |
| SSM standard parameters, Run Command, Session Manager | free |
| GHCR (public packages), sslip.io, Let's Encrypt | free |
| **AWS total** | **about $40/month** before data transfer; Supabase is billed separately |

A 1-year Savings Plan cuts the instance cost by about 35 %. A t3.small (2 GiB) is enough for the API alone but
leaves no room for the demo pipeline or larger validation jobs.

## Teardown

```bash
export AWS_REGION=ap-south-1 MSYS_NO_PATHCONV=1
I=i-0fb9646b9ad18744b
aws ec2 modify-instance-attribute --instance-id $I --no-disable-api-termination
aws ec2 terminate-instances --instance-ids $I && aws ec2 wait instance-terminated --instance-ids $I
aws ec2 release-address --allocation-id $(aws ec2 describe-addresses --filters Name=tag:Name,Values=shriii-backend \
  --query 'Addresses[0].AllocationId' --output text)
aws ec2 delete-security-group --group-id $(aws ec2 describe-security-groups --filters Name=group-name,Values=shriii-backend \
  --query 'SecurityGroups[0].GroupId' --output text)
aws ec2 delete-key-pair --key-name shriii-backend && rm -f ~/.ssh/shriii-backend.pem
aws iam remove-role-from-instance-profile --instance-profile-name shriii-backend-ec2 --role-name shriii-backend-ec2
aws iam delete-instance-profile --instance-profile-name shriii-backend-ec2
aws iam delete-role-policy --role-name shriii-backend-ec2 --policy-name shriii-prod-ssm-read
aws iam detach-role-policy --role-name shriii-backend-ec2 --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam delete-role --role-name shriii-backend-ec2
# Only when the whole deployment is retired (destroys the keys the data depends on):
# aws ssm delete-parameters --names $(aws ssm get-parameters-by-path --path /shriii/prod/ --query 'Parameters[].Name' --output text)
```

The database stays on Supabase until deleted there ([supabase.md](supabase.md)).
