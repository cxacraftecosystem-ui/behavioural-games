"""Hosted-Postgres lockdown (Supabase): no Data API reach into the research schemas.

* Revokes every privilege of the Supabase API roles (``anon``, ``authenticated``, ``service_role``) on
  the research schemas and their tables, sequences and functions, and stops future objects created by
  the migrating role from being granted to them. Each role is handled only if it exists, so on plain
  PostgreSQL (CI, Docker Compose, RDS) this part is a no-op.
* Enables row-level security with no policy (deny-all for non-owners) on the Alembic version table,
  the only table the migrations put in ``public``. The owner (the migrating role) bypasses RLS, so
  Alembic keeps working.

The research schemas are never added to PostgREST's exposed schemas; see docs/deploy/supabase.md.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-22
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

from shriii_api.db.base import RESEARCH_SCHEMAS

revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

API_ROLES = ("anon", "authenticated", "service_role")


def revoke_api_roles(schemas: Sequence[str]) -> str:
    """A DO block revoking the Supabase API roles' privileges on ``schemas`` (skips missing roles)."""
    names = ", ".join(schemas)
    roles = ", ".join(f"'{r}'" for r in API_ROLES)
    return f"""
        DO $$
        DECLARE
            r text;
        BEGIN
            FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ({roles}) LOOP
                EXECUTE format('REVOKE ALL ON SCHEMA {names} FROM %I', r);
                EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA {names} FROM %I', r);
                EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA {names} FROM %I', r);
                EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA {names} FROM %I', r);
                EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA {names} REVOKE ALL ON TABLES FROM %I', r);
                EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA {names} REVOKE ALL ON SEQUENCES FROM %I', r);
                EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA {names} REVOKE ALL ON FUNCTIONS FROM %I', r);
            END LOOP;
        END;
        $$;
        """


def upgrade() -> None:
    op.execute(revoke_api_roles(RESEARCH_SCHEMAS))
    op.execute("ALTER TABLE public.alembic_version ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.alembic_version FROM PUBLIC")


def downgrade() -> None:
    op.execute("ALTER TABLE public.alembic_version DISABLE ROW LEVEL SECURITY")
    # Revoked privileges are not re-granted: the API roles never had any by design.
