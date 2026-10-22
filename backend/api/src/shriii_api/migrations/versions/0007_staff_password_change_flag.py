"""Staff accounts: ``must_change_password`` flag.

A password set by an operator with ``shriii-api create-staff-user`` is an initial password that other people
have seen (it travels through SSM and a person). The web app prompts the user to replace it after signing in.
``POST /api/v1/auth/password`` clears the flag.

Existing rows are all marked: every account so far was created from the CLI and the API cannot tell whether
its password was changed since, so each user is asked once more.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "staff_users",
        sa.Column("must_change_password", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema="governance",
    )
    op.execute("UPDATE governance.staff_users SET must_change_password = true")


def downgrade() -> None:
    op.drop_column("staff_users", "must_change_password", schema="governance")
