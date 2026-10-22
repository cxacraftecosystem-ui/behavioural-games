# Database on Supabase (production pilot)

The research database and the identity vault run on a dedicated Supabase project. The API and worker run on
EC2 in the same region and connect over the Supavisor session pooler. No secret appears in this document or
in the repository; every credential lives in AWS SSM Parameter Store.

## Project

| Item | Value |
|---|---|
| Project | `shriii-kiosk-games`, ref `qcxfjelfjqdvxcjeitiv` |
| Organisation | `pifvglrcqwrizapmooik` (the other projects in this org are unrelated and must not be touched) |
| Region | `ap-south-1` (Mumbai), for DPDP data residency |
| Engine | PostgreSQL 17 (Supabase does not offer 18 yet; see [PostgreSQL 17 compatibility](#postgresql-17-compatibility)) |

## Databases and roles

The identity vault is a **separate database in the same project** with its own login role and password. A
second project was not needed: the research role cannot connect to the vault database, and the vault role has
no privileges in the research database's schemas.

| Database | Login role | Owns | Notes |
|---|---|---|---|
| `postgres` | `shriii_api` | the research schemas (`kiosk_raw`, `scored`, `criterion`, `linkage`, `consent`, `study`, `games`, `validation`, `reporting`, `governance`, `ops`) and `public.alembic_version` | not superuser, no CREATEROLE/CREATEDB/BYPASSRLS; CREATE on database `postgres` and on schema `public` only |
| `shriii_identity` | `shriii_identity` | database `shriii_identity`, schema `identity_vault`, `public.alembic_version_identity` | `CONNECT` revoked from `PUBLIC`, so only this role (and Supabase's superuser) can connect |

The NOLOGIN roles from migration 0002 (`shriii_app`, `shriii_erasure`, `shriii_analyst`) are pre-created by
`infra/supabase/bootstrap_roles.py`, because the migrating role has no CREATEROLE on Supabase. Migration 0002
then grants them as designed. On the raw-event, criterion-response, consent-artefact and audit tables,
`shriii_app` has SELECT and INSERT only and `shriii_erasure` has SELECT and DELETE. The append-only triggers
apply to every role, the table owner included.

The Supabase `postgres` role is used only to run the bootstrap. The app never uses it.

## Connection approach

- **Host:** the Supavisor **session pooler** at `aws-0-ap-south-1.pooler.supabase.com:5432`. It is reachable
  over IPv4, while the direct host `db.<ref>.supabase.co` is IPv6 only. The username is `<role>.<ref>`.
- **Session mode (5432)**, not transaction mode (6543). SQLAlchemy and psycopg 3 use server-side prepared
  statements, `SET LOCAL` (`shriii.mutation_purpose` on the erasure path) and advisory locks, and all of these
  need a stable session. Session mode supports them. Transaction mode does not.
- **TLS:** the URLs carry `sslmode=require`.
- **Pool size:** each API or worker process holds up to `2 x DB_POOL_SIZE` connections. Keep the total under
  the pooler's session limit for the project's compute size; on small compute, lower `DB_POOL_SIZE` to around 5.

## SSM parameters (SecureString, region ap-south-1, tag `Project=shriii-kiosk-games`)

| Name | Contents |
|---|---|
| `/shriii/prod/db_password` | password of the Supabase `postgres` role (bootstrap and break-glass only) |
| `/shriii/prod/db_app_password` | password of `shriii_api` |
| `/shriii/prod/identity_db_password` | password of `shriii_identity` |
| `/shriii/prod/DATABASE_URL` | `postgresql+psycopg://shriii_api.<ref>:***@<pooler>:5432/postgres?sslmode=require` |
| `/shriii/prod/IDENTITY_DATABASE_URL` | `postgresql+psycopg://shriii_identity.<ref>:***@<pooler>:5432/shriii_identity?sslmode=require` |

All passwords are 40-character alphanumeric strings from a CSPRNG (`secrets`). Re-running
`bootstrap_roles.py` rotates the two login passwords and overwrites their SSM parameters. Restart the API
and worker after a rotation.

## Migrations and seed

Run these from a machine with SSM read access. The traffic is plain network: the pooler over TLS, with no
Docker involved.

```bash
export MSYS_NO_PATHCONV=1   # Git Bash on Windows only
export DATABASE_URL=$(aws ssm get-parameter --name /shriii/prod/DATABASE_URL --with-decryption --query Parameter.Value --output text)
export IDENTITY_DATABASE_URL=$(aws ssm get-parameter --name /shriii/prod/IDENTITY_DATABASE_URL --with-decryption --query Parameter.Value --output text)
uv run shriii-api migrate     # research to head (0005), identity to head (i0002)
uv run shriii-api seed        # instruments, dictionary, games, content versions
```

The demo study (`demo-s2-pilot`) was seeded with `seed_demo_study`. `seed --demo` does the same and also
registers a dev kiosk, but only when `ENV` is dev or test, so do not run it with a dev `ENV` against production.

Status on 2026-10-22: research at `0005` (92 tables in 11 schemas, the 9 initial event partitions included, plus `public.alembic_version`), identity at
`i0002` (2 tables). The seed added 16 instruments, 17 constructs, 100 indicators, 14 games, 7 content versions
and the demo study.

## Data API lockdown

The project's Data API (PostgREST) is never used. The app talks to Postgres directly.

- **Exposed schemas** stay at the default `public, graphql_public`. Never add the research schemas or
  `identity_vault`. Checked: a request with `Accept-Profile: kiosk_raw` or `identity_vault` returns `PGRST106`
  (invalid schema).
- **`public`** holds only `alembic_version`. Migration 0005 enables row-level security on it with no policy
  (deny-all for non-owners) and revokes `PUBLIC`. `anon` gets `42501 permission denied` through the API.
  i0002 does the same for `alembic_version_identity`, which sits in a database that PostgREST does not
  serve anyway.
- **API roles:** migrations 0005 and i0002 revoke every privilege that `anon`, `authenticated` and
  `service_role` hold on our schemas, their tables, sequences and functions, and on future objects (default
  privileges). On plain PostgreSQL these roles do not exist and the step is a no-op.
- The `anon` and `service_role` API keys are not used by any SHRIII component. Do not distribute them.

## PostgreSQL 17 compatibility

The plan targeted PostgreSQL 18. An audit of all migrations (research 0001 to 0005, identity i0001 to i0002)
found no feature that needs 18: no `uuidv7()`, virtual generated columns, temporal `WITHOUT OVERLAPS`/`PERIOD`
constraints, `RETURNING OLD/NEW` or other new syntax. UUIDv7 ids are already generated in the application
(`shriii_api.security.new_uuid7`, the kiosk client), and server defaults use only `now()`. CI now runs the
migrations, seed, a second idempotent migrate and an Alembic-heads check against both `postgres:17` and
`postgres:18` (the `migrations` matrix job in `.github/workflows/ci.yml`), so a feature that needs 18 cannot
slip in. The rest of CI stays on 18.

## Operations notes

- **Backups:** Supabase daily backups come with the plan. Turn on PITR before real participant data arrives.
- **Event partitions:** migration 0002 creates `kiosk_raw.events_pYYYYMMDD` for yesterday to day +7. The
  worker must keep creating them.
- **Network restrictions:** after the EC2 Elastic IP is fixed, restrict database access to it (and the
  operator IP) under Supabase network restrictions.
- **Least privilege at runtime (follow-up):** the API currently connects as the schema owner `shriii_api`.
  The append-only guarantees hold because they are enforced by triggers, not grants. A separate runtime login
  that is a member of `shriii_app` would tighten this further.
