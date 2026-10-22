"""Staff accounts for self-hosted login (``AUTH_MODE=local``).

``governance.staff_users`` holds staff accounts for deployments that have no OIDC provider yet: a scrypt
password hash (never the password), roles, study scope, a disabled flag and a failed-login lockout.
Accounts are created or reset only with ``shriii-api create-staff-user`` (password on stdin).

The application role ``shriii_app`` gets read/write on the table; ``shriii_analyst`` gets nothing. The
Supabase API roles get nothing either (0005 removed their default privileges in these schemas).

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "staff_users",
        sa.Column("username", sa.String(length=128), nullable=False),
        sa.Column("password_hash", sa.String(length=512), nullable=False),
        sa.Column(
            "roles", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
        sa.Column(
            "studies", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
        sa.Column("disabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("password_changed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(length=256), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("username", name=op.f("pk_staff_users")),
        schema="governance",
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shriii_app') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON governance.staff_users TO shriii_app;
            END IF;
        END;
        $$;
        """
    )


def downgrade() -> None:
    op.drop_table("staff_users", schema="governance")
