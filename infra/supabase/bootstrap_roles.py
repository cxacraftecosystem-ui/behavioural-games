r"""Bootstrap the SHRIII roles and identity vault database on a Supabase project (idempotent).

Run once after creating the project, from a machine with AWS credentials for SSM:

    PW=$(aws ssm get-parameter --name /shriii/prod/db_password --with-decryption \
         --query Parameter.Value --output text) \
    uv run python infra/supabase/bootstrap_roles.py --ref <project-ref> \
        --pooler-host aws-0-ap-south-1.pooler.supabase.com

It connects as ``postgres`` (password in env ``PW``) and:

* pre-creates the NOLOGIN roles ``shriii_app``, ``shriii_erasure``, ``shriii_analyst`` that migration 0002
  grants to (the migrating role has no CREATEROLE on Supabase);
* creates ``shriii_api`` (LOGIN, owns the research schemas; CREATE on database ``postgres`` and schema
  ``public`` for the Alembic version table) and ``shriii_identity`` (LOGIN, owns database
  ``shriii_identity``; no access to the research schemas);
* rotates both login passwords (CSPRNG) and writes them, plus ``DATABASE_URL`` and
  ``IDENTITY_DATABASE_URL`` (Supavisor session pooler, port 5432, sslmode=require), to SSM as SecureString.

Nothing secret is printed. Re-running rotates the two login passwords.
"""

from __future__ import annotations

import argparse
import os
import secrets
import string
import subprocess

import psycopg
from psycopg import sql

TAGS = "Key=Project,Value=shriii-kiosk-games"


def gen() -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(40))


def ssm_put(region: str, name: str, value: str, desc: str) -> None:
    base = ["aws", "ssm", "put-parameter", "--region", region, "--name", name, "--type", "SecureString"]
    exists = subprocess.run(
        ["aws", "ssm", "get-parameter", "--region", region, "--name", name], capture_output=True, check=False
    )
    extra = ["--overwrite"] if exists.returncode == 0 else ["--tags", TAGS]
    subprocess.run([*base, "--value", value, "--description", desc, *extra], check=True, stdout=subprocess.DEVNULL)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True)
    ap.add_argument("--pooler-host", required=True)
    ap.add_argument("--region", default="ap-south-1")
    ap.add_argument("--prefix", default="/shriii/prod")
    a = ap.parse_args()

    def url(user: str, pw: str, db: str) -> str:
        return f"postgresql+psycopg://{user}.{a.ref}:{pw}@{a.pooler_host}:5432/{db}?sslmode=require"

    app_pw, id_pw = gen(), gen()
    admin = {"host": a.pooler_host, "port": 5432, "user": f"postgres.{a.ref}", "dbname": "postgres"}
    with psycopg.connect(**admin, password=os.environ["PW"], autocommit=True) as c:
        for role in ("shriii_app", "shriii_erasure", "shriii_analyst", "shriii_api", "shriii_identity"):
            login = "LOGIN" if role in ("shriii_api", "shriii_identity") else "NOLOGIN"
            c.execute(
                sql.SQL(
                    "DO $$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = {}) "
                    "THEN CREATE ROLE {} {}; END IF; END$$"
                ).format(sql.Literal(role), sql.Identifier(role), sql.SQL(login))
            )
        # Non-superuser CREATEROLE may not state SUPERUSER/BYPASSRLS attributes; the defaults are "no".
        c.execute(sql.SQL("ALTER ROLE shriii_api LOGIN PASSWORD {}").format(sql.Literal(app_pw)))
        c.execute(sql.SQL("ALTER ROLE shriii_identity LOGIN PASSWORD {}").format(sql.Literal(id_pw)))
        c.execute("GRANT CREATE ON DATABASE postgres TO shriii_api")
        c.execute("GRANT CREATE, USAGE ON SCHEMA public TO shriii_api")
        if not c.execute("SELECT 1 FROM pg_database WHERE datname = 'shriii_identity'").fetchone():
            c.execute("GRANT shriii_identity TO postgres WITH SET TRUE")
            c.execute("CREATE DATABASE shriii_identity OWNER shriii_identity")
            c.execute("REVOKE shriii_identity FROM postgres")
    # Only the owner can revoke the default PUBLIC CONNECT/TEMP on the vault database.
    vault = {"host": a.pooler_host, "port": 5432, "user": f"shriii_identity.{a.ref}", "dbname": "shriii_identity"}
    with psycopg.connect(**vault, password=id_pw, autocommit=True) as c:
        c.execute("REVOKE ALL ON DATABASE shriii_identity FROM PUBLIC")

    p = a.prefix
    ssm_put(a.region, f"{p}/db_app_password", app_pw, "Supabase shriii_api role password (research DB owner)")
    ssm_put(a.region, f"{p}/identity_db_password", id_pw, "Supabase shriii_identity role password (identity vault)")
    ssm_put(a.region, f"{p}/DATABASE_URL", url("shriii_api", app_pw, "postgres"), "Research DB URL (session pooler)")
    ssm_put(
        a.region,
        f"{p}/IDENTITY_DATABASE_URL",
        url("shriii_identity", id_pw, "shriii_identity"),
        "Identity vault DB URL (session pooler)",
    )
    print("roles, identity database and SSM parameters are in place")


if __name__ == "__main__":
    main()
