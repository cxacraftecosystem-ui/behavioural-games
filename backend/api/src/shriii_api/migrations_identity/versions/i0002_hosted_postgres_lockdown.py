"""Hosted-Postgres lockdown for the identity vault (see research revision 0005).

Revokes the Supabase API roles' privileges on ``identity_vault`` (no-op when the roles do not exist)
and enables deny-all row-level security on the identity Alembic version table in ``public``.

Revision ID: i0002
Revises: i0001
Create Date: 2026-10-22
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "i0002"
down_revision: str | Sequence[str] | None = "i0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        DECLARE
            r text;
        BEGIN
            FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
                EXECUTE format('REVOKE ALL ON SCHEMA identity_vault FROM %I', r);
                EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA identity_vault FROM %I', r);
                EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA identity_vault FROM %I', r);
                EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA identity_vault REVOKE ALL ON TABLES FROM %I', r);
                EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA identity_vault REVOKE ALL ON SEQUENCES FROM %I', r);
            END LOOP;
        END;
        $$;
        """
    )
    op.execute("ALTER TABLE public.alembic_version_identity ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.alembic_version_identity FROM PUBLIC")
    op.execute("REVOKE ALL ON SCHEMA identity_vault FROM PUBLIC")


def downgrade() -> None:
    op.execute("ALTER TABLE public.alembic_version_identity DISABLE ROW LEVEL SECURITY")
