# Backend on AWS EC2 (production pilot)

The API and the job worker run as containers on one EC2 instance in `ap-south-1` (Mumbai), behind Caddy,
which terminates TLS with an automatic Let's Encrypt certificate. The databases are on Supabase in the same
region ([supabase.md](supabase.md)). Images are built by GitHub Actions, pushed to GHCR and mirrored to ECR; the
instance pulls from ECR with its instance role. Every secret
lives in AWS SSM Parameter Store; none is in this repository, in an image, or in user data.

```
browser ──▶ Vercel web app ──HTTPS (server-side rewrite /api/v1/*)──▶ Caddy :443 (52-66-109-32.sslip.io, HSTS, size limits, security headers)
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
| IAM | role and instance profile `shriii-backend-ec2`: `ssm:GetParameter(s)`/`GetParametersByPath` on `/shriii/prod/*`, `kms:Decrypt` on the `aws/ssm` key via SSM only, `AmazonSSMManagedInstanceCore`, ECR pull on the two backend repositories |
| Key pair | `shriii-backend` (ed25519); private key only on the operator machine at `~/.ssh/shriii-backend.pem` |
| Images | `ghcr.io/cxacraftecosystem-ui/behavioural-games-api` and `-worker` (private until made public in the GitHub UI), mirrored to `626159998512.dkr.ecr.ap-south-1.amazonaws.com/shriii/behavioural-games-api` and `-worker`; tags `<commit sha>` and `latest` |
| CI to AWS | GitHub OIDC provider + role `shriii-gha-ecr-push` (trusts only `refs/heads/main` of this repository; push to the two ECR repositories only). No AWS keys in GitHub. |
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

**CORS.** Browsers normally never call this host directly: the web app proxies `/api/v1/*` server side
([Web app on Vercel](#web-app-on-vercel)), so every browser request is same-origin and CORS does not apply. For
direct calls the API still allows exactly `API_CORS_ORIGINS=https://behavioural-games.vercel.app` plus
`API_CORS_ORIGIN_REGEX=https://behavioural-games-[a-z0-9-]+-cxacraftecosystem-8028s-projects\.vercel\.app`,
which matches only this team's preview URLs (`behavioural-games-<hash>-…` and `behavioural-games-git-<branch>-…`).
Starlette full-matches the pattern, so suffixes such as `….vercel.app.evil.example` are refused
(`backend/api/tests/test_prod_cors.py`). One gap remains: another Vercel team could name a project
`behavioural-games-x-cxacraftecosystem-8028s-projects` and get a matching production URL. Auth uses bearer
tokens, not cookies, so a matching origin still cannot ride a user's session. Add a custom domain to
`API_CORS_ORIGINS` when one exists.

**Staff accounts (`AUTH_MODE=local`).** There is no Cognito/OIDC provider yet, so staff accounts are stored in
`governance.staff_users` (migrations 0006 and 0007) with scrypt password hashes. The web app's sign-in page
(`/login`) takes an email or username and password; `POST /api/v1/auth/login` (`{"username","password"}`)
returns a bearer JWT (HS256, `LOCAL_JWT_SECRET`, 8 h) and `password_change_required`. Five failed attempts lock
an account for 15 minutes. `POST /api/v1/auth/password` (web: user menu, Change password, `/account/password`)
changes the caller's password and clears the change prompt. Accounts are created or reset only from the CLI
(`shriii-api create-staff-user <username> --roles ... [--studies ...] [--reset] [--no-change-prompt]`, password on
stdin), never over HTTP. A CLI-issued password is marked as an initial password (`must_change_password`), so the
web app sends the user to the change-password screen after sign-in and shows a banner until it is changed;
`--no-change-prompt` is only for service accounts whose password lives in SSM. Migration 0007 marked every
existing account. Tokens cannot be refreshed: the web app shows when the session ends, warns 5 minutes before
the 8-hour token expires and then signs the user out. Sign-out drops the token and all cached data in the tab.
`GET /api/v1/auth/providers` reports which sign-in methods are enabled. To move to OIDC later, set
`AUTH_MODE=oidc`, `OIDC_JWKS_URL`, `JWT_ISSUER` and `JWT_AUDIENCE`; the staff table then goes unused.

**Google sign-in (off until configured).** `POST /api/v1/auth/google` (`{"credential": "<Google ID token>"}`)
is enabled only when `GOOGLE_CLIENT_ID` is set, which `render-env.sh` fills from the optional SSM parameter
`/shriii/prod/google_client_id`. It verifies the ID token against Google's JWKS (RS256), requires `iss`
`accounts.google.com` or `https://accounts.google.com`, `aud` equal to `GOOGLE_CLIENT_ID`, an unexpired `exp` and
`email_verified` true (`shriii_api/auth/google.py`). It then signs the caller in **only** when the verified email
equals the username of an existing, active staff account; roles and study scope come from that record. Unknown
or disabled emails get 403 and an `auth.login_google` audit row with outcome `denied`; no account is ever
created. The web app uses the Google Identity Services ID-token flow, which needs only the client id: **no client
secret is used or stored**, and no redirect URI is involved. Steps are under
[Turning on Google sign-in](#turning-on-google-sign-in).

## SSM parameters (`/shriii/prod/`, SecureString)

| Name | Made by | Used as |
|---|---|---|
| `DATABASE_URL`, `IDENTITY_DATABASE_URL` | `infra/supabase/bootstrap_roles.py` | env vars of the same name |
| `db_password`, `db_app_password`, `identity_db_password` | `bootstrap_roles.py` | operator material (not loaded into containers) |
| `LOCAL_JWT_SECRET` (48 bytes), `PID_HMAC_PEPPER`, `SESSION_KEY_KEK`, `BACKEND_X25519_PRIVATE_KEY`, `RELEASE_PACK_SIGNING_KEY`, `IDENTITY_VAULT_KEY` (32 bytes each, base64) | `infra/ec2/init-secrets.sh` | env vars of the same name |
| `admin_initial_password` | `init-secrets.sh` | first admin password, read by `create-admin.sh` |
| `smoke_test_password` | operator (generated) | password of the smoke-test account `smoke-test@shriii.local` used by the live Playwright check |
| `google_client_id` (optional) | operator, from Google Cloud Console | rendered as `GOOGLE_CLIENT_ID`; unset = Google sign-in off |

`render-env.sh` copies every upper-case name under the prefix into `/etc/shriii/api.env` at each deploy and
skips lower-case names, except `google_client_id`, which it maps to `GOOGLE_CLIENT_ID`. The instance role can read the prefix but cannot write anything.

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
| Roll back | `run "/opt/shriii/src/infra/ec2/deploy.sh <older full commit sha> main"` (each image tag is a commit sha; see the Images workflow summary or `aws ecr describe-images --repository-name shriii/behavioural-games-api`) |
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

`synthetic.sh smoke` seals the batches of one simulated session to the backend X25519 key (AES-256-GCM, as a
real kiosk does), posts them to the public HTTPS endpoint with a device token, and waits for the worker
container to finish the jobs the upload queued. Production refuses events flagged `synthetic` (ENV=prod), which
is the path this test must exercise, so the smoke clears that flag on its one session. The session stays
identifiable: it comes from the simulator kiosk `kiosk-sim-01` (site `site-sim-01`, revoked again afterwards)
and belongs to the study `synthetic-smoke` ("SYNTHETIC SMOKE TEST").

`synthetic.sh demo` runs `shriii-api demo-pipeline` into a study whose id starts with `synthetic-` and whose
name starts with "SYNTHETIC DEMO", so the research dashboards have data. The default size is the CI size (24
players per language + 8 retests: about 56 sessions, 68k raw events, 230 MB). The Supabase organisation is on
the **Pro plan with an 8 GB disk** ([supabase.md](supabase.md#plan-and-disk)). During the `--fast` preset (about
470k events, 1.4 GB) on 2026-10-22 the database nevertheless turned read-only at about 838 MB, far below the
disk size, and the synthetic raw data had to be truncated. **The cause is unexplained.** An earlier version of
this document blamed a 500 MB free-plan cap; that was wrong, because the project is not on the free plan. Until
the cause is known, run only the default size, and check the database size
(`select pg_size_pretty(pg_database_size('postgres'))`) and the Supabase disk usage before larger runs and before
real data collection: raw events cost about 3 KB each including indexes. The pipeline drives the API
in-process, so it runs in a one-off container with `ENV=dev`/`AUTH_MODE=dev` and a throwaway dev secret; the
public API stays `ENV=prod`. The worker is paused during the run. Afterwards the cleanup step revokes the
simulator kiosk (`kiosk-sim-01`) and undoes the dev-only instrument approvals the pipeline records (synthetic
"granted" permissions and dev-approved language versions), so no instrument looks licensed for real use. The
synthetic chunks are stored as `none_dev` plaintext: they are simulated players, not participants. Remove a
synthetic study through the normal erasure/retention paths, or leave it as a labelled demo.

### Smoke-test staff account

`smoke-test@shriii.local` is a service account for the live end-to-end check (role `researcher`, study scope
limited to the synthetic demo study, so it cannot see any other study). Its password is generated on the operator
machine, stored only in `/shriii/prod/smoke_test_password`, passed to `create-staff-user` on stdin through SSM
(never in argv or command output), and created with `--no-change-prompt`. The researcher role can still write
within that synthetic study; the check only reads. Disable the account when it is not needed:
`UPDATE governance.staff_users SET disabled = true WHERE username = 'smoke-test@shriii.local'`.

### Database network access

Supabase network restrictions allow the database (direct and pooler) only from the Elastic IP `52.66.109.32/32`
and the operator IP `49.47.131.192/32`; IPv6 is closed. Change them with
`supabase network-restrictions update --project-ref qcxfjelfjqdvxcjeitiv --db-allow-cidr <cidr> ... --experimental`
(the list is replaced, so pass every CIDR). Running migrations or `bootstrap_roles.py` from another machine
needs its IP added first.

## Verification (2026-10-22)

| Check | Result |
|---|---|
| `https://52-66-109-32.sslip.io/healthz`, `/readyz` | 200; `{"database":"ok","identity_database":"ok","migration":"0006"}`; Let's Encrypt certificate (issuer YE2) verifies; HTTP redirects with 308 |
| Headers | HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy present; `Server` removed |
| Auth | `POST /api/v1/auth/dev-login` 404; `admin` created over SSM and signs in via `/api/v1/auth/login`; wrong password 401 |
| CORS | a `behavioural-games-*.vercel.app` origin is allowed; an unrelated origin is refused |
| Migrations on Supabase | research `0006`, identity `i0002` (head) |
| Sealed UploadBatch over HTTPS | 1,190 events accepted, visible in `kiosk_raw.events` on Supabase; the worker container ran `trial_eligibility` and `feature_extraction` (both succeeded) |
| Demo pipeline (`synthetic-demo-20261022`) | 48 synthetic participants, 56 sessions, 68,250 events accepted; every hard check passed (events accepted, no failed job, analyses succeeded, model trained with holdout, gates and report fail closed); soft check `planted_dif_recovered` not met at this sample size, as expected; cleanup revoked `kiosk-sim-01` and restored 11 instrument permissions and 30 language versions |

## Web app on Vercel

Vercel project `behavioural-games` (scope `cxacraftecosystem-8028s-projects`, production
`https://behavioural-games.vercel.app`, Git-connected: a merge to `main` deploys production).

- **Production uses the live API.** `next.config.ts` rewrites `/api/v1/*`, `/healthz` and `/readyz` to
  `API_PROXY_TARGET` on the server, so the browser only talks to the Vercel origin, bearer tokens never cross
  origins and CORS does not apply. A Vercel build without demo mode fails fast if `API_PROXY_TARGET` is missing
  or not `https://`, or if `NEXT_PUBLIC_AUTH_MODE` is still `dev`.
- **Previews stay self-contained.** Preview deployments keep `NEXT_PUBLIC_DEMO_MODE=1` (in-app demo API with
  synthetic fixtures, writes refused), so a pull request never touches the production API or database.
- **The public `/kiosk` never uploads.** The web kiosk sends events only when the build is configured as a
  registered kiosk device (`NEXT_PUBLIC_KIOSK_API_BASE` **and** `NEXT_PUBLIC_KIOSK_DEVICE_ID`), which production
  does not set. The public website is not a registered kiosk: nobody supervises consent there, visitors are not
  enrolled in a study, and a kiosk device token can never be embedded in a public JavaScript bundle. Research
  data comes only from registered kiosks (`frontend/apps/kiosk-electron`). The API would also refuse an upload
  without a device token.

| Variable | Production | Preview |
|---|---|---|
| `NEXT_PUBLIC_DEMO_MODE` | `0` | `1` |
| `NEXT_PUBLIC_AUTH_MODE` | `local` | unset (demo sign-in) |
| `API_PROXY_TARGET` | `https://52-66-109-32.sslip.io` | unset |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | unset until Google is configured | unset |

Change them with `vercel env add <NAME> production` or `vercel env rm <NAME> production` from the repository
root (it is linked), then redeploy (merge to `main`, or `vercel deploy --prod` from the root). `NEXT_PUBLIC_*`
values and the rewrites are fixed at build time, so every change needs a new build.

### Turning on Google sign-in

1. Google Cloud Console, APIs & Services, OAuth consent screen: user type External, app name, support email;
   scopes `openid`, `email` and `profile` only.
2. Credentials, Create credentials, OAuth client ID, application type **Web application**, name for example
   `SHRIII web (behavioural-games)`.
   - Authorized JavaScript origins: `https://behavioural-games.vercel.app` (add `http://localhost:3000` only for
     local testing).
   - Authorized redirect URIs: none. The ID-token popup flow does not use one. If a redirect flow is ever added,
     the URI would be `https://behavioural-games.vercel.app/auth/google/callback`.
   - Google also shows a client secret. It is not used; do not store it anywhere.
3. `aws ssm put-parameter --name /shriii/prod/google_client_id --type String --value <client id>` (a client id
   is not secret), then redeploy the backend (`deploy.sh`), which renders `GOOGLE_CLIENT_ID`.
4. `vercel env add NEXT_PUBLIC_GOOGLE_CLIENT_ID production` with the same id, then redeploy production. The
   button appears on `/login`, which then relaxes `Cross-Origin-Opener-Policy` to `same-origin-allow-popups` and
   `Referrer-Policy` to `strict-origin-when-cross-origin`, as Google Identity Services requires.
5. Only staff whose account username is their Google email can use the button. Create such accounts with
   `create-staff-user <email> --roles ...`.

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
infra/ec2/provision-ecr.sh                                  # ECR mirror, GitHub OIDC push role, instance pull policy
# user data installs Docker, compose, the AWS CLI and the checkout, and deploys if images exist; otherwise:
run "/opt/shriii/src/infra/ec2/deploy.sh latest main"
run "/opt/shriii/src/infra/ec2/create-admin.sh admin"
```

`infra/ec2/provision-ecr.sh` creates the ECR repositories, the GitHub OIDC provider, the push role and the
instance role's pull policy. GHCR packages under a personal account start private, and their visibility can only
be changed in the GitHub UI (package settings, Change visibility), which is why the instance pulls from ECR. To
pull from GHCR instead once the packages are public, add `IMAGE_REGISTRY=ghcr.io/cxacraftecosystem-ui` to
`/etc/shriii/deploy.env`.

## Costs (ap-south-1, on-demand, approximate)

| Item | Monthly |
|---|---|
| t3.medium (2 vCPU, 4 GiB) | about $33 |
| 30 GB gp3 | about $2.7 |
| Elastic IP / public IPv4 | about $3.6 |
| Data out | first 100 GB/month free, then about $0.11/GB |
| SSM standard parameters, Run Command, Session Manager | free |
| ECR storage (two repositories, newest 30 images each, about 0.4 GB per image) | about $1-3 |
| GHCR, sslip.io, Let's Encrypt | free |
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
aws iam delete-role-policy --role-name shriii-backend-ec2 --policy-name shriii-ecr-pull
aws iam delete-role --role-name shriii-backend-ec2
aws iam delete-role-policy --role-name shriii-gha-ecr-push --policy-name shriii-ecr-push
aws iam delete-role --role-name shriii-gha-ecr-push
for r in api worker; do aws ecr delete-repository --repository-name shriii/behavioural-games-$r --force; done
# The GitHub OIDC provider may be shared with other projects; delete only if nothing else uses it:
# aws iam delete-open-id-connect-provider --open-id-connect-provider-arn arn:aws:iam::626159998512:oidc-provider/token.actions.githubusercontent.com
# Only when the whole deployment is retired (destroys the keys the data depends on):
# aws ssm delete-parameters --names $(aws ssm get-parameters-by-path --path /shriii/prod/ --query 'Parameters[].Name' --output text)
```

The database stays on Supabase until deleted there ([supabase.md](supabase.md)).
